import { execFileSync, spawn, spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { A } from "ayy";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { git } from "./git.ts";

const SCRIPT = join(import.meta.dirname, "..", "bin", "review-commits");
const PROMPTS = join(import.meta.dirname, "..", "review-prompts");

/**
 * @param script The text of review-commits.
 * @param name The name of one of its arrays of reviewers.
 * @returns The words in that array: models, or MODEL:FOCUS for codex reviewers.
 */
function words_in(script: string, name: string): string[] {
	const list = new RegExp("^" + name + "=\\(([^)]*)\\)$", "m").exec(script)?.[1];
	A(list !== undefined, "review-commits must set " + name + " on a line of its own");
	const words = list.split(" ");
	A.gte(words.length, 1);
	return words;
}

const SCRIPT_TEXT = await readFile(SCRIPT, "utf8");
/** Each codex reviewer's model and the focus that picks its prompt, from the MODEL:FOCUS words of codex_reviewers */
const CODEX_PAIRS = words_in(SCRIPT_TEXT, "codex_reviewers").map((reviewer) => {
	const parts = reviewer.split(":");
	A.eq(parts.length, 2, "a codex reviewer must be MODEL:FOCUS, not " + reviewer);
	const [model, focus] = parts as [string, string];
	A.gt(model.length, 0);
	A.gt(focus.length, 0);
	return [model, focus] as const;
});
const CODEX_REVIEWERS = CODEX_PAIRS.map(([model]) => model);
const CLAUDE_REVIEWERS = words_in(SCRIPT_TEXT, "claude_reviewers");
const REVIEWERS = [...CODEX_REVIEWERS, ...CLAUDE_REVIEWERS];
A.eq(new Set(REVIEWERS).size, REVIEWERS.length);
const CODEX_FOCUSES = new Map(CODEX_PAIRS);
const CLAUDE_FALLBACK_MODEL = /^claude_fallback_model=(\S+)$/m.exec(SCRIPT_TEXT)?.[1];
A(CLAUDE_FALLBACK_MODEL !== undefined, "review-commits must set claude_fallback_model on a line of its own");

/**
 * Stands in for both `codex` and `claude`. Finds its model in `-c model=MODEL`
 * or `--model MODEL`; if $FAKE_HANG is set, starts a `sleep` that it waits for
 * at the end. Writes how it was run (with the options of the fake bwrap that
 * started it, if any), followed by what it read from stdin, to $CALLS/MODEL,
 * all at once, prints a transcript line to stderr and a review to stdout, and
 * exits with status 1 if its model is $FAKE_FAIL.
 */
const FAKE_REVIEWER = `#!/usr/bin/env bash
model=
previous=
for arg in "$@"; do
	if [[ $arg == model=* ]]; then
		model=\${arg#model=}
	elif [[ $previous == --model ]]; then
		model=$arg
	fi
	previous=$arg
done
child=
if [[ -n $FAKE_HANG ]]; then
	sleep 30 &
	child=$!
fi
{
	printf 'arg %s\\n' "$@"
	echo "pwd $(pwd)"
	echo "head $(git rev-parse HEAD)"
	echo "stdin $(readlink /proc/self/fd/0)"
	echo "child $child"
	printf '%s' "$FAKE_SANDBOX"
	echo "stdin text:"
	cat
} > "$CALLS/.$model"
mv "$CALLS/.$model" "$CALLS/$model"
echo "transcript of $model" >&2
echo "review by $model"
wait
[[ $model != "$FAKE_FAIL" ]]
`;

/** Stands in for bwrap: runs the command after `--`, giving it the options before `--` in $FAKE_SANDBOX, as a "sandbox OPTION" line each. */
const FAKE_BWRAP = `#!/usr/bin/env bash
options=
while [[ $1 != -- ]]; do
	options+="sandbox $1"$'\\n'
	shift
done
shift
FAKE_SANDBOX=$options exec "$@"
`;

/**
 * Stands in for `codex` inside a real sandbox, and prints what it can see: the
 * files in $HOME, the files in the test's directory (the parent of $TMPDIR),
 * the HEAD of its clone, codex's auth.json, how many processes there are, and
 * the start of its stdin.
 */
const PROBE_CODEX = `#!/usr/bin/env bash
echo "home $(cd "$HOME" && find . -mindepth 1 | LC_ALL=C sort | tr '\\n' ' ')"
echo "root $(ls -A "$(dirname "$TMPDIR")" | tr '\\n' ' ')"
echo "head $(git rev-parse HEAD)"
echo "auth $(cat "$HOME/.codex/auth.json")"
echo "processes $(ls /proc | grep -c '^[0-9]')"
echo "prompt $(head -c 120)"
`;

/**
 * Stands in for `claude` inside a real sandbox, and prints what it can see: the
 * files in $HOME outside ~/.claude, the files in ~/.claude, whether it can read
 * ~/.claude/history.jsonl, claude's login, and how many processes there are.
 * Then it saves a session file in ~/.claude/projects, and makes a directory in
 * ~/.claude, as claude does to lock its login while it refreshes it.
 */
const PROBE_CLAUDE = `#!/usr/bin/env bash
echo "home $(cd "$HOME" && find . -mindepth 1 -not -path './.claude/*' | LC_ALL=C sort | tr '\\n' ' ')"
echo "claude $(cd "$HOME/.claude" && find . -mindepth 1 | LC_ALL=C sort | tr '\\n' ' ')"
echo "history $(cat "$HOME/.claude/history.jsonl" 2> /dev/null || echo unreadable)"
echo "login $(cat "$HOME/.claude/.credentials.json")"
echo "processes $(ls /proc | grep -c '^[0-9]')"
mkdir -p "$HOME/.claude/projects/p" "$HOME/.claude/.refresh.lock"
echo "own session" > "$HOME/.claude/projects/p/s.jsonl"
`;

/** Whether a real bwrap is on PATH, and can make a sandbox here (it needs unprivileged user namespaces). */
const REAL_BWRAP_WORKS = spawnSync("bwrap", ["--ro-bind", "/", "/", "--unshare-pid", "true"]).status === 0;

/** The test's directory, which holds every directory below. */
let root: string;
/** The repository whose commits get reviewed. */
let repo: string;
/** Where each fake reviewer writes how it was run. */
let calls: string;
/** The HOME of review-commits, so its reviews go to `home`/.ai-code-reviews. */
let home: string;
/** The TMPDIR of review-commits, where it makes its clone. */
let tmp: string;
/** Holds the fake `codex`, `claude` and `bwrap`, ahead of the real ones on PATH. */
let fake_bin: string;

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "clank-right-review-"));
	repo = join(root, "repo");
	calls = join(root, "calls");
	home = join(root, "home");
	tmp = join(root, "tmp");
	fake_bin = join(root, "bin");
	for (const dir of [repo, calls, home, tmp, fake_bin]) {
		await mkdir(dir);
	}
	for (const [name, text] of [["codex", FAKE_REVIEWER], ["claude", FAKE_REVIEWER], ["bwrap", FAKE_BWRAP]] as const) {
		await writeFile(join(fake_bin, name), text);
		await chmod(join(fake_bin, name), 0o755);
	}

	await git(repo, "init", "--quiet", "--initial-branch=master");
	await git(repo, "config", "user.email", "test@example.com");
	await git(repo, "config", "user.name", "Test");
	await git(repo, "config", "commit.gpgsign", "false");
	for (const n of [1, 2, 3]) {
		await writeFile(join(repo, "f"), n + "\n");
		await git(repo, "add", "f");
		await git(repo, "commit", "--quiet", "--message", "Commit " + n);
	}
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

/**
 * @param fake The settings for the fake reviewers: FAKE_FAIL, FAKE_HANG, or none.
 * @returns The environment for review-commits, with the fake reviewers on PATH.
 */
function script_env(fake: Record<string, string> = {}): NodeJS.ProcessEnv {
	return { ...process.env, PATH: fake_bin + ":" + process.env["PATH"], HOME: home, TMPDIR: tmp, CALLS: calls, ...fake };
}

/**
 * @param args The arguments for review-commits.
 * @param fail The model whose fake reviewer exits with status 1, or "" for none.
 * @returns The exit status and output of review-commits, run in `repo`.
 */
function review_commits(args: string[], fail = ""): { status: number | null; stdout: string; stderr: string } {
	// A test can't time out while spawnSync blocks, so spawnSync has a timeout of its own
	const result = spawnSync(SCRIPT, args, { cwd: repo, encoding: "utf8", env: script_env({ FAKE_FAIL: fail }), timeout: 3_000 });
	return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/**
 * Checks `condition` every 20 ms until it holds.
 *
 * @param condition What to wait for.
 * @param what Describes `condition`, for the error if it never holds.
 * @throws Error if `condition` doesn't hold within 3 seconds, which is less than a test may take.
 */
async function until(condition: () => boolean | Promise<boolean>, what: string): Promise<void> {
	const deadline = Date.now() + 3_000;
	while (!(await condition())) {
		if (Date.now() > deadline) {
			throw new Error("timed out waiting until " + what);
		}
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
}

/**
 * @param pid A process ID.
 * @returns Whether a process (or a zombie not yet reaped) has that ID.
 */
function exists(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

/**
 * @param model A reviewer's model.
 * @param name The name of the review, a full hash or a range of them.
 * @returns The path of that review.
 */
function review_path(model: string, name: string): string {
	return join(home, ".ai-code-reviews", model, name);
}

/**
 * @param model A reviewer's model.
 * @returns How the fake reviewer for `model` was run: one `arg` line per argument, then its working directory, HEAD, stdin, the PID of its `sleep` (if any), one `sandbox` line per option that the fake bwrap got, and the text it read from stdin.
 */
function call_of(model: string): Promise<string> {
	return readFile(join(calls, model), "utf8");
}

describe("review-commits", () => {
	it("reviews one commit with every reviewer, in a clone at that commit, then deletes the clone", async () => {
		const commit = await git(repo, "rev-parse", "HEAD~1");
		const result = review_commits(["HEAD~1"]);
		expect(result.stderr).toBe("");
		expect(result.status).toBe(0);
		for (const model of REVIEWERS) {
			const call = await call_of(model);
			expect(call).toContain("pwd " + tmp + "/review-commits.");
			expect(call).toContain("head " + commit + "\n");
			expect(await readFile(review_path(model, commit), "utf8")).toContain("review by " + model + "\n");
			expect(result.stdout).toContain("=== " + model + " (exit status 0): " + review_path(model, commit) + "\n");
		}
		for (const [model, focus] of CODEX_FOCUSES) {
			const call = await call_of(model);
			expect(call).toContain("arg exec\n");
			expect(call).toContain("arg model=" + model + "\narg -c\narg model_reasoning_effort=xhigh\narg -\n");
			expect(call).toContain("stdin " + tmp + "/review-commits.");
			for (const option of ["--unshare-pid", "--tmpfs\nsandbox " + home, "--tmpfs\nsandbox /tmp", "--tmpfs\nsandbox " + tmp, "--tmpfs\nsandbox " + home + "/.codex", "--ro-bind\nsandbox " + repo + "/.git/objects"]) {
				expect(call).toContain("sandbox " + option + "\n");
			}
			expect(call).toContain("sandbox --bind\nsandbox " + tmp + "/review-commits.");
			for (const file of ["auth.json", "auth.lock"]) {
				expect(call).toContain("sandbox --bind-try\nsandbox " + home + "/.codex/" + file + "\n");
			}
			const prompt = call.slice(call.indexOf("stdin text:\n") + "stdin text:\n".length);
			expect(prompt).toMatch(new RegExp("^You are reviewing code changes made by another engineer: commit " + commit + " \\(HEAD\\) in this repository\\."));
			expect(prompt).toContain(await readFile(join(PROMPTS, "codex-" + focus + ".md"), "utf8"));
			expect(prompt.endsWith(await readFile(join(PROMPTS, "codex-common.md"), "utf8"))).toBe(true);
			expect(await readFile(review_path(model, commit), "utf8")).toBe("review by " + model + "\n");
			expect(await readFile(review_path(model, commit) + ".log", "utf8")).toBe("transcript of " + model + "\n");
		}
		for (const model of CLAUDE_REVIEWERS) {
			const call = await call_of(model);
			expect(call).toContain("stdin /dev/null\n");
			for (const option of ["--unshare-pid", "--tmpfs\nsandbox " + home, "--tmpfs\nsandbox /tmp", "--bind-try\nsandbox " + home + "/.claude\nsandbox " + home + "/.claude", "--bind\nsandbox " + review_path(model, commit) + ".transcript\nsandbox " + home + "/.claude/projects"]) {
				expect(call).toContain("sandbox " + option + "\n");
			}
			expect(call).not.toContain("sandbox " + home + "/.codex");
			expect(call).toContain("arg --fallback-model\narg " + CLAUDE_FALLBACK_MODEL + "\n");
			expect(call).toContain("arg --settings\narg " + JSON.stringify({ env: { CLAUDE_CODE_SUBAGENT_MODEL: model } }) + "\n");
			expect(call).toContain("arg /code-review xhigh commit " + commit + "\n");
		}
		expect(await readdir(tmp)).toEqual([]);
	});

	it("reviews the commits after BASE up to and including LAST, as BASE..LAST", async () => {
		const base = await git(repo, "rev-parse", "HEAD~2");
		const last = await git(repo, "rev-parse", "HEAD");
		const name = base + ".." + last;
		const result = review_commits(["HEAD~2..HEAD"]);
		expect(result.status).toBe(0);
		for (const model of REVIEWERS) {
			expect(await call_of(model)).toContain("head " + last + "\n");
			expect(await readFile(review_path(model, name), "utf8")).toContain("review by " + model + "\n");
		}
		for (const model of CODEX_REVIEWERS) {
			expect(await call_of(model)).toContain("stdin text:\nYou are reviewing code changes made by another engineer: the commits after " + base + " up to and including " + last + " (HEAD) in this repository.");
		}
		for (const model of CLAUDE_REVIEWERS) {
			expect(await call_of(model)).toContain("arg /code-review xhigh commits " + name + "\n");
		}
	});

	it("prints every review and the end of a failed codex transcript, then exits with status 1", async () => {
		const commit = await git(repo, "rev-parse", "HEAD");
		const result = review_commits(["HEAD"], "gpt-6.1-sol");
		expect(result.status).toBe(1);
		expect(result.stdout).toContain(
			"=== gpt-6.1-sol (exit status 1): " + review_path("gpt-6.1-sol", commit) + "\n" +
			"review by gpt-6.1-sol\n" +
			"--- the end of its transcript, " + review_path("gpt-6.1-sol", commit) + ".log:\n" +
			"transcript of gpt-6.1-sol\n",
		);
		for (const model of REVIEWERS) {
			expect(result.stdout).toContain("review by " + model + "\n");
		}
		expect(await readdir(tmp)).toEqual([]);
	});

	it("on SIGTERM, stops every reviewer and what it started, deletes the clone, and exits with status 143", async () => {
		const script = spawn(SCRIPT, ["HEAD"], { cwd: repo, env: script_env({ FAKE_HANG: "1" }), stdio: "ignore" });
		const exit_status = new Promise<number | null>((resolve) => {
			script.on("exit", (code) => {
				resolve(code);
			});
		});
		await until(async () => (await readdir(calls)).filter((file) => !file.startsWith(".")).length === REVIEWERS.length, "every reviewer has started");
		script.kill("SIGTERM");
		expect(await exit_status).toBe(143);
		expect(await readdir(tmp)).toEqual([]);
		for (const model of REVIEWERS) {
			const child = /^child (\d+)$/m.exec(await call_of(model));
			A(child !== null, "the fake reviewer for " + model + " must have started a sleep");
			// A killed `sleep` exists as a zombie until its new parent reaps it
			await until(() => !exists(Number(child[1])), "the sleep of " + model + " has exited");
		}
	});

	it("refuses to run with status 2, starting no reviewer, when bwrap is not on PATH", async () => {
		// A PATH with only bash and git, which review-commits needs before it looks for bwrap
		const bare_bin = join(root, "bare-bin");
		await mkdir(bare_bin);
		for (const name of ["bash", "git"]) {
			await symlink(execFileSync("bash", ["-c", 'command -v "$0"', name], { encoding: "utf8" }).trim(), join(bare_bin, name));
		}
		const result = spawnSync(SCRIPT, ["HEAD"], { cwd: repo, encoding: "utf8", env: { ...script_env(), PATH: bare_bin }, timeout: 3_000 });
		expect(result.status).toBe(2);
		expect(result.stderr).toContain("bwrap is not on PATH");
		expect(await readdir(calls)).toEqual([]);
		expect(await readdir(tmp)).toEqual([]);
	});

	it.each([
		["a codex reviewer isn't MODEL:FOCUS", (script: string) => script.replace(/^codex_reviewers=\(\S+/m, "codex_reviewers=(gpt-x"), "a codex reviewer must be MODEL:FOCUS, not gpt-x\n"],
		["a model is a reviewer twice", (script: string) => script.replace(/^claude_reviewers=\(\S+/m, "claude_reviewers=(" + CODEX_REVIEWERS[0]), CODEX_REVIEWERS[0] + " is a reviewer twice"],
		["a focus has no prompt", (script: string) => script.replace(/^codex_reviewers=\(\S+/m, "codex_reviewers=(gpt-x:nonexistent"), "no prompt $ROOT/clank-right/bin/../review-prompts/codex-nonexistent.md\n"],
	])("refuses to run with status 2, starting no reviewer, when %s", async (_, edit, message) => {
		// A copy of the script, edited, that finds the real review-prompts/ next to its bin/
		const bin = join(root, "clank-right", "bin");
		await mkdir(bin, { recursive: true });
		await symlink(PROMPTS, join(root, "clank-right", "review-prompts"));
		await writeFile(join(bin, "review-commits"), edit(SCRIPT_TEXT));
		await chmod(join(bin, "review-commits"), 0o755);
		const result = spawnSync(join(bin, "review-commits"), ["HEAD"], { cwd: repo, encoding: "utf8", env: script_env(), timeout: 3_000 });
		expect(result.stderr).toContain("review-commits: " + message.replace("$ROOT", root));
		expect(result.status).toBe(2);
		expect(await readdir(calls)).toEqual([]);
		expect(await readdir(tmp)).toEqual([]);
	});

	it.skipIf(!REAL_BWRAP_WORKS)("hides other reviews, transcripts, files in /tmp and other processes from every reviewer", async () => {
		// PATH dirs in the home directory are visible in the sandbox, so the probes go there
		const home_bin = join(home, "bin");
		await mkdir(home_bin);
		await writeFile(join(home_bin, "codex"), PROBE_CODEX);
		await writeFile(join(home_bin, "claude"), PROBE_CLAUDE);
		const settings = { hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: home + "/hooks/firewall --strict" }] }] } };
		for (const [file, text] of [
			[".ai-code-reviews/m/old", "old review"], [".codex/sessions/s.jsonl", "transcript"], [".codex/auth.json", "token"], [".codex/config.toml", "x = 1"],
			[".claude/projects/p/s.jsonl", "transcript"], [".claude/sessions/1.json", "session"], [".claude/history.jsonl", "prompts"], [".claude/.credentials.json", "claude token"],
			[".claude/settings.json", JSON.stringify(settings)], ["hooks/firewall", "#!/bin/sh"], [".config/claude-outbound-firewall/blocked-strings", "name"], [".config/gh/hosts.yml", "secret"],
		] as const) {
			await mkdir(join(home, file, ".."), { recursive: true });
			await writeFile(join(home, file), text);
		}
		for (const file of ["bin/codex", "bin/claude", "hooks/firewall"]) {
			await chmod(join(home, file), 0o755);
		}
		const commit = await git(repo, "rev-parse", "HEAD");
		const result = spawnSync(SCRIPT, ["HEAD"], { cwd: repo, encoding: "utf8", env: { ...script_env(), PATH: home_bin + ":" + process.env["PATH"] }, timeout: 10_000 });
		expect(result.status).toBe(0);
		for (const model of CODEX_REVIEWERS) {
			const review = await readFile(review_path(model, commit), "utf8");
			// The home directory has only the PATH dirs in it and codex's own files
			expect(review).toContain("home ./.codex ./.codex/auth.json ./.codex/auth.lock ./.codex/config.toml ./bin ./bin/claude ./bin/codex \n");
			// Of the test's directory in /tmp, only the clone's directory and the objects that it borrows are there
			expect(review).toContain("root home repo tmp \n");
			expect(review).not.toContain("calls");
			expect(review).toContain("head " + commit + "\n");
			expect(review).toContain("auth token\n");
			expect(review).toContain("prompt You are reviewing code changes made by another engineer: commit " + commit);
			const processes = /^processes (\d+)$/m.exec(review);
			A(processes !== null, "the probe must count the processes it sees");
			A.lte(Number(processes[1]), 10);
		}
		for (const model of CLAUDE_REVIEWERS) {
			const review = await readFile(review_path(model, commit), "utf8");
			// Outside ~/.claude, the home directory has only the PATH dirs, the hook's directory, and the file that the hook reads
			expect(review).toContain("home ./.claude ./.config ./.config/claude-outbound-firewall ./.config/claude-outbound-firewall/blocked-strings ./bin ./bin/claude ./bin/codex ./hooks ./hooks/firewall \n");
			// In ~/.claude, other files can't be read, and other directories are empty
			expect(review).toContain("claude ./.credentials.json ./history.jsonl ./projects ./sessions ./settings.json \n");
			expect(review).toContain("history unreadable\n");
			expect(review).toContain("login claude token\n");
			const processes = /^processes (\d+)$/m.exec(review);
			A(processes !== null, "the probe must count the processes it sees");
			A.lte(Number(processes[1]), 10);
			expect(await readFile(review_path(model, commit) + ".transcript/p/s.jsonl", "utf8")).toBe("own session\n");
		}
		// The lock that claude makes in its directory is in the real one, which every claude shares
		expect(await readdir(join(home, ".claude", ".refresh.lock"))).toEqual([]);
		expect(await readFile(join(home, ".claude/projects/p/s.jsonl"), "utf8")).toBe("transcript");
	});

	it.each([
		[[]],
		[["HEAD", "HEAD~1"]],
		[["nonexistent"]],
		[["HEAD~2...HEAD"]],
		[["HEAD..HEAD~1"]],
		[["HEAD..HEAD"]],
		[["..HEAD"]],
	])("refuses the arguments %j with status 2, starting no reviewer", async (args: string[]) => {
		const result = review_commits(args);
		expect(result.status).toBe(2);
		expect(result.stderr).toContain("Usage: review-commits COMMIT, or review-commits BASE..LAST\n");
		expect(await readdir(calls)).toEqual([]);
		expect(await readdir(tmp)).toEqual([]);
	});
});
