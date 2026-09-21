// Model-output: Claude Fable 5.1
//
// The few git operations the tool needs.

import { getLogger } from "@logtape/logtape";
import { run_process } from "./process.ts";

const log = getLogger(["clank-right", "git"]);

/** git itself refused or failed; its stderr is in the message. */
export class GitError extends Error {}

/**
 * @param repo The repository's working directory.
 * @param args Arguments to git.
 * @returns Trimmed stdout.
 * @throws GitError on a non-zero exit status.
 */
export async function git(repo: string, ...args: string[]): Promise<string> {
	log.debug("git {args} in {repo}", { args, repo });
	const result = await run_process("git", ["-C", repo, ...args]);
	if (result.code !== 0) {
		throw new GitError(`git ${args.join(" ")} failed in ${repo}: ${result.stderr.trim()}`);
	}
	return result.stdout.trim();
}

/** How a file's index and working-tree contents relate to HEAD. */
export type FileState = "clean" | "untracked" | "modified";

/**
 * @param repo The repository's working directory.
 * @param path A file path relative to it.
 * @returns "modified" when the file is tracked and differs from HEAD, whether or not the change is staged.
 */
export async function file_state(repo: string, path: string): Promise<FileState> {
	const status = await git(repo, "status", "--porcelain", "--", path);
	if (status === "") {
		return "clean";
	}
	if (status.startsWith("??")) {
		return "untracked";
	}
	return "modified";
}

/**
 * Commits the working-tree contents of one file and nothing else; whatever
 * else is staged stays staged.
 * @param repo The repository's working directory.
 * @param path A file path relative to it.
 * @param message The commit message.
 * @returns The new commit's short hash.
 */
export async function commit_only(repo: string, path: string, message: string): Promise<string> {
	await git(repo, "add", "--", path);
	await git(repo, "commit", "--quiet", "--only", "--message", message, "--", path);
	return await git(repo, "rev-parse", "--short", "HEAD");
}

/**
 * @param repo The repository's working directory.
 * @returns `git describe --always --dirty`: enough to find the commit later, and whether the tree was clean.
 */
export async function describe(repo: string): Promise<string> {
	return await git(repo, "describe", "--always", "--dirty");
}
