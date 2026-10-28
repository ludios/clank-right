// Model-output: Claude Fable 5.1
// Model-output: Claude Opus 5.5
//
// The few git operations the tool needs.

import { A, AssertionError } from "ayy";
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
 * @returns The new commit's short hash, which needn't be HEAD's by the time this returns.
 */
export async function commit_only(repo: string, path: string, message: string): Promise<string> {
	await git(repo, "add", "--", path);
	// Its summary, e.g. "[master 1a2b3c4] subject", names the commit made even when HEAD has already moved on (a
	// post-commit hook, another process); a branch name can't contain the space before the hash.
	const out = await git(repo, "commit", "--only", "--message", message, "--", path);
	const match = /^\[[^\n]*? ([0-9a-f]{4,})\] /.exec(out);
	if (match === null) {
		throw new AssertionError(`git commit in ${repo} made a commit but printed no "[branch hash]" summary: ${out}`, commit_only);
	}
	return match[1]!;
}

/**
 * Points HEAD (the checked-out branch, or a detached HEAD) at `to`, but only if it still points at `from`. Git checks
 * that while holding the ref's lock, so a commit that another process made after `from` was read is never lost.
 * @param repo The repository's working directory.
 * @param to The commit to point at.
 * @param from The commit HEAD must point at now.
 * @param reason Why, for the reflog.
 * @returns Whether HEAD moved; false when it no longer pointed at `from`, or another git process held its lock.
 */
export async function move_head(repo: string, to: string, from: string, reason: string): Promise<boolean> {
	try {
		await git(repo, "update-ref", "-m", reason, "HEAD", to, from);
	} catch (error) {
		if (!(error instanceof GitError)) {
			throw error;
		}
		log.warning("left HEAD in {repo} alone instead of moving it from {from} to {to}: {error}", {
			repo, from, to, error: error.message,
		});
		return false;
	}
	return true;
}

/**
 * Squashes HEAD's commit into its parent, as `git commit --amend` on the parent would have made it: one commit with
 * HEAD's tree and message, the parent's parent, and the current author and date. HEAD moves to it only while HEAD is
 * still `head` and `head` is on `parent`, so that no other commit is rewritten or lost.
 * @param repo The repository's working directory.
 * @param head The commit expected at HEAD, e.g. one just made.
 * @param parent The commit expected as `head`'s parent; it must have a parent of its own.
 * @returns The new commit's short hash, or null when `head` isn't on `parent` or HEAD moved off `head`; HEAD is then
 * left alone.
 */
export async function squash_head_into(repo: string, head: string, parent: string): Promise<string | null> {
	const hashes = (await git(repo, "rev-parse", `${head}^`, `${parent}^{commit}`)).split("\n");
	A.eq(hashes.length, 2);
	if (hashes[0] !== hashes[1]) {
		log.warning("not squashing {head} in {repo} into {parent}, since another commit landed between them", { head, repo, parent });
		return null;
	}
	const message = await git(repo, "log", "--max-count=1", "--format=%B", head);
	const squashed = await git(repo, "commit-tree", `${head}^{tree}`, "-p", `${parent}^`, "-m", message);
	if (!await move_head(repo, squashed, head, `clank-right: squash ${head} into ${parent}`)) {
		return null;
	}
	return await git(repo, "rev-parse", "--short", squashed);
}
