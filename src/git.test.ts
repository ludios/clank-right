// Model-output: Claude Fable 5.1
// Model-output: Claude Opus 5.5

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { commit_only, file_state, git, head_commit, move_head, other_refs_containing_head, squash_head_into } from "./git.ts";

let repo: string;

beforeEach(async () => {
	repo = await mkdtemp(join(tmpdir(), "clank-right-git-"));
	await git(repo, "init", "--quiet", "--initial-branch=master");
	await git(repo, "config", "user.email", "test@example.com");
	await git(repo, "config", "user.name", "Test");
	await git(repo, "config", "commit.gpgsign", "false");
});

afterEach(async () => {
	await rm(repo, { recursive: true, force: true });
});

/**
 * @param message The commit message.
 * @param files The contents to commit, by path.
 * @returns The new commit's short hash.
 */
async function commit(message: string, files: Record<string, string>): Promise<string> {
	for (const [path, text] of Object.entries(files)) {
		await writeFile(join(repo, path), text);
		await git(repo, "add", "--", path);
	}
	await git(repo, "commit", "--quiet", "--message", message);
	return await git(repo, "rev-parse", "--short", "HEAD");
}

describe("file_state", () => {
	it("follows a file from untracked through its first commit, before and after HEAD exists", async () => {
		expect(await file_state(repo, "f")).toBe("clean");
		await writeFile(join(repo, "f"), "one\n");
		expect(await file_state(repo, "f")).toBe("untracked");
		await git(repo, "add", "f");
		expect(await file_state(repo, "f")).toBe("modified");
		await git(repo, "commit", "--quiet", "--message", "initial");
		expect(await file_state(repo, "f")).toBe("clean");
		await writeFile(join(repo, "g"), "new\n");
		await git(repo, "add", "g");
		expect(await file_state(repo, "g")).toBe("modified");
	});

	it("compares the working tree with HEAD, not the index", async () => {
		await writeFile(join(repo, "f"), "one\n");
		await git(repo, "add", "f");
		await git(repo, "commit", "--quiet", "--message", "initial");
		await writeFile(join(repo, "f"), "two\n");
		expect(await file_state(repo, "f")).toBe("modified");
		await git(repo, "add", "f");
		expect(await file_state(repo, "f")).toBe("modified");
		await writeFile(join(repo, "f"), "one\n");
		expect(await git(repo, "status", "--porcelain", "--", "f")).toBe("MM f");
		expect(await file_state(repo, "f")).toBe("clean");
		await rm(join(repo, "f"));
		expect(await file_state(repo, "f")).toBe("modified");
	});
});

describe("head_commit", () => {
	it("is null before the first commit, then describes HEAD", async () => {
		expect(await head_commit(repo)).toBeNull();
		const root = await commit("initial", { f: "one\n", g: "one\n" });
		expect(await head_commit(repo)).toEqual({ sha: root, parents: [], subject: "initial", paths: ["f", "g"] });
		const second = await commit("second\n\nwith a body", { f: "two\n" });
		expect(await head_commit(repo)).toEqual({ sha: second, parents: [root], subject: "second", paths: ["f"] });
	});
});

describe("other_refs_containing_head", () => {
	it("lists every ref but the checked-out branch that has HEAD's commit", async () => {
		await commit("initial", { f: "one\n" });
		expect(await other_refs_containing_head(repo)).toEqual([]);
		await git(repo, "update-ref", "refs/remotes/origin/master", "HEAD");
		await git(repo, "tag", "t");
		expect(await other_refs_containing_head(repo)).toEqual(["refs/remotes/origin/master", "refs/tags/t"]);
		await commit("second", { f: "two\n" });
		expect(await other_refs_containing_head(repo)).toEqual([]);
		await git(repo, "checkout", "--quiet", "--detach");
		expect(await other_refs_containing_head(repo)).toEqual(["refs/heads/master"]);
	});
});

describe("commit_only", () => {
	it("names the commit it made, whatever the branch", async () => {
		const head = () => git(repo, "rev-parse", "--short", "HEAD");
		await writeFile(join(repo, "f"), "one\n");
		expect(await commit_only(repo, "f", "root")).toBe(await head());
		await git(repo, "checkout", "--quiet", "-b", "odd]name");
		await writeFile(join(repo, "f"), "two\n");
		expect(await commit_only(repo, "f", "x 1234] y")).toBe(await head());
		await git(repo, "checkout", "--quiet", "--detach");
		await writeFile(join(repo, "f"), "three\n");
		expect(await commit_only(repo, "f", "detached")).toBe(await head());
	});
});

describe("move_head", () => {
	it("moves the checked-out branch only from the commit it expects", async () => {
		const first = await commit("first", { f: "one\n" });
		const second = await commit("second", { f: "two\n" });
		expect(await move_head(repo, first, first, "test")).toBe(false);
		expect(await git(repo, "rev-parse", "--short", "master")).toBe(second);
		expect(await move_head(repo, first, second, "test")).toBe(true);
		expect(await git(repo, "rev-parse", "--short", "master")).toBe(first);
		expect(await git(repo, "symbolic-ref", "HEAD")).toBe("refs/heads/master");
	});
});

describe("squash_head_into", () => {
	it("makes one commit of HEAD and its parent, with HEAD's tree and message", async () => {
		await commit("root", { f: "one\n" });
		const parent = await commit("parent", { f: "two\n" });
		const head = await commit("head\n\nTrailer: x", { g: "one\n" });
		const squashed = await squash_head_into(repo, head, parent);
		expect(squashed).toBe(await git(repo, "rev-parse", "--short", "master"));
		expect(await git(repo, "log", "--format=%s")).toBe("head\nroot");
		expect(await git(repo, "log", "--max-count=1", "--format=%B")).toBe("head\n\nTrailer: x");
		expect(await git(repo, "diff", head, "HEAD")).toBe("");
	});

	it("leaves HEAD alone once another commit is between the two, or on top", async () => {
		await commit("root", { f: "one\n" });
		const parent = await commit("parent", { f: "two\n" });
		const between = await commit("between", { g: "one\n" });
		const head = await commit("head", { g: "two\n" });
		expect(await squash_head_into(repo, head, parent)).toBeNull();
		expect(await git(repo, "rev-parse", "--short", "HEAD")).toBe(head);

		const on_top = await commit("on top", { g: "three\n" });
		expect(await squash_head_into(repo, head, between)).toBeNull();
		expect(await git(repo, "rev-parse", "--short", "HEAD")).toBe(on_top);
		expect(await git(repo, "log", "--format=%s")).toBe("on top\nhead\nbetween\nparent\nroot");
	});
});
