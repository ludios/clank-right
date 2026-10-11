// Model-output: Claude Fable 5.1
// Model-output: Claude Opus 5.5
//
// The few git operations the tool needs.

import { A } from "ayy";
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

/** How a file's working-tree contents relate to HEAD. */
type FileState = "clean" | "untracked" | "modified";

/**
 * @param repo The repository's working directory.
 * @param path A file path relative to it.
 * @returns "modified" when the file is tracked and its working-tree contents differ from HEAD's, whether or not
 * that change is staged. A change that is only staged, with the working tree back at HEAD, counts as clean.
 */
export async function file_state(repo: string, path: string): Promise<FileState> {
	const status = await git(repo, "status", "--porcelain", "--", path);
	if (status === "") {
		return "clean";
	}
	if (status.startsWith("??")) {
		return "untracked";
	}
	if (status.startsWith("A")) {
		// Added to the index but not in HEAD, which may not even exist yet.
		return "modified";
	}
	const differing = await git(repo, "diff", "--name-only", "HEAD", "--", path);
	return differing === "" ? "clean" : "modified";
}

/** A commit, as much of it as `head_commit` reports. */
interface Commit {
	/** The abbreviated hash. */
	sha: string;
	/** Its parents' abbreviated hashes: none for a root commit, several for a merge. */
	parents: string[];
	/** The first line of its message. */
	subject: string;
	/** The paths it changes from its parent, relative to the top of the repository; none for a merge. */
	paths: string[];
}

/**
 * @param repo The repository's working directory.
 * @returns The commit HEAD points at, or null on a branch with no commits yet.
 */
export async function head_commit(repo: string): Promise<Commit | null> {
	// --ignore-missing makes a HEAD with no commit print nothing instead of failing.
	const out = await git(repo, "log", "--max-count=1", "--ignore-missing", "--format=%h%x00%p%x00%s%x00", "--name-only", "HEAD");
	if (out === "") {
		return null;
	}
	const fields = out.split("\0");
	A.eq(fields.length, 4);
	const [sha, parents, subject, paths] = fields as [string, string, string, string];
	return {
		sha,
		parents: parents.split(" ").filter((parent) => parent !== ""),
		subject,
		paths:   paths.split("\n").filter((path) => path !== ""),
	};
}

/**
 * @param repo The repository's working directory.
 * @returns Every ref but the checked-out branch whose history includes HEAD's commit: remote-tracking branches (as
 * of the last fetch or push), tags, other branches. When there are none, rewriting the commit forks no history that
 * this clone knows of.
 */
export async function other_refs_containing_head(repo: string): Promise<string[]> {
	// Just "HEAD" when detached, which matches no ref.
	const branch = await git(repo, "rev-parse", "--symbolic-full-name", "HEAD");
	const refs = await git(repo, "for-each-ref", "--contains=HEAD", "--format=%(refname)");
	return refs.split("\n").filter((ref) => ref !== "" && ref !== branch);
}

/**
 * Commits the working-tree contents of one file and nothing else; whatever
 * else is staged stays staged.
 * @param repo The repository's working directory.
 * @param path A file path relative to it.
 * @param message The commit message.
 * @param amend Whether to replace HEAD's commit, rather than add one on top, with one that has HEAD's parents and
 * HEAD's tree but for `path`, and the current author and date.
 * @returns The new commit's short hash.
 */
export async function commit_only(repo: string, path: string, message: string, amend = false): Promise<string> {
	await git(repo, "add", "--", path);
	const amend_args = amend ? ["--amend", "--reset-author"] : [];
	await git(repo, "commit", "--quiet", "--only", ...amend_args, "--message", message, "--", path);
	return await git(repo, "rev-parse", "--short", "HEAD");
}
