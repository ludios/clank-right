import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { git } from "./git.ts";

const SCRIPT = join(import.meta.dirname, "..", "bin", "review-commits");
const CODEX_REVIEWERS = ["gpt-6-astra", "gpt-6.1-sol", "gpt-5.6-sol"];
const CLAUDE_REVIEWERS = ["claude-mythos-5-1", "claude-opus-5-5"];
const REVIEWERS = [...CODEX_REVIEWERS, ...CLAUDE_REVIEWERS];

/**
 * Stands in for both `codex` and `claude`. Finds its model in `-c model=MODEL`
 * or `--model MODEL`, writes how it was run to $CALLS/MODEL, prints a
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
{
	printf 'arg %s\\n' "$@"
	echo "pwd $(pwd)"
	echo "head $(git rev-parse HEAD)"
	echo "stdin $(readlink /proc/self/fd/0)"
} > "$CALLS/$model"
echo "transcript of $model" >&2
echo "review by $model"
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
 * @param args The arguments for review-commits.
 * @param fail The model whose fake reviewer exits with status 1, or "" for none.
 * @returns The exit status and output of review-commits, run in `repo`.
 */
function review_commits(args: string[], fail = ""): { status: number | null; stdout: string; stderr: string } {
	const result = spawnSync(SCRIPT, args, {
		cwd:      repo,
		encoding: "utf8",
		env:      { ...process.env, PATH: fake_bin + ":" + process.env["PATH"], HOME: home, TMPDIR: tmp, CALLS: calls, FAKE_FAIL: fail },
	});
	return { status: result.status, stdout: result.stdout, stderr: result.stderr };
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
 * @returns How the fake reviewer for `model` was run: one `arg` line per argument, then its working directory, HEAD, and stdin.
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
			expect(await call_of(model)).toContain("arg /code-review xhigh commit " + commit + "\n");
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
