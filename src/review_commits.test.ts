import { spawn, spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { A } from "ayy";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { git } from "./git.ts";

const SCRIPT = join(import.meta.dirname, "..", "bin", "review-commits");

/**
 * @param script The text of review-commits.
 * @param name The name of one of its arrays of models.
 * @returns The models in that array.
 */
function models_in(script: string, name: string): string[] {
	const list = new RegExp("^" + name + "=\\(([^)]*)\\)$", "m").exec(script)?.[1];
	A(list !== undefined, "review-commits must set " + name + " on a line of its own");
	const models = list.split(" ");
	A.gte(models.length, 1);
	return models;
}

const SCRIPT_TEXT = await readFile(SCRIPT, "utf8");
const CODEX_REVIEWERS = models_in(SCRIPT_TEXT, "codex_reviewers");
const CLAUDE_REVIEWERS = models_in(SCRIPT_TEXT, "claude_reviewers");
const REVIEWERS = [...CODEX_REVIEWERS, ...CLAUDE_REVIEWERS];
const CLAUDE_FALLBACK_MODEL = /^claude_fallback_model=(\S+)$/m.exec(SCRIPT_TEXT)?.[1];
A(CLAUDE_FALLBACK_MODEL !== undefined, "review-commits must set claude_fallback_model on a line of its own");

/**
 * Stands in for both `codex` and `claude`. Finds its model in `-c model=MODEL`
 * or `--model MODEL`; if $FAKE_HANG is set, starts a `sleep` that it waits for
 * at the end. Writes how it was run to $CALLS/MODEL, all at once, prints a
 * transcript line to stderr and a review to stdout, and exits with status 1
 * if its model is $FAKE_FAIL.
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
} > "$CALLS/.$model"
mv "$CALLS/.$model" "$CALLS/$model"
echo "transcript of $model" >&2
echo "review by $model"
wait
[[ $model != "$FAKE_FAIL" ]]
`;

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
/** Holds the fake `codex` and `claude`, ahead of the real ones on PATH. */
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
	for (const name of ["codex", "claude"]) {
		await writeFile(join(fake_bin, name), FAKE_REVIEWER);
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
 * @returns How the fake reviewer for `model` was run: one `arg` line per argument, then its working directory, HEAD, stdin, and the PID of its `sleep` (if any).
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
			expect(call).toContain("stdin /dev/null\n");
			expect(await readFile(review_path(model, commit), "utf8")).toContain("review by " + model + "\n");
			expect(result.stdout).toContain("=== " + model + " (exit status 0): " + review_path(model, commit) + "\n");
		}
		for (const model of CODEX_REVIEWERS) {
			expect(await call_of(model)).toContain("arg --commit\narg " + commit + "\n");
			expect(await readFile(review_path(model, commit), "utf8")).toBe("review by " + model + "\n");
			expect(await readFile(review_path(model, commit) + ".log", "utf8")).toBe("transcript of " + model + "\n");
		}
		for (const model of CLAUDE_REVIEWERS) {
			const call = await call_of(model);
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
			expect(await call_of(model)).toContain("arg --base\narg " + base + "\n");
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
