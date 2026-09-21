// Model-output: Claude Fable 5.1

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { file_state, git } from "./git.ts";

describe("file_state", () => {
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
