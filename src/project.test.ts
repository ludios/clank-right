// Model-output: Claude Fable 5.1
// Model-output: Claude Opus 5
// Model-output: Claude Opus 5.5

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { array, assert, asyncProperty, boolean, constantFrom, record, uniqueArray, type Arbitrary } from "fast-check";
import { stringify as stringify_toml } from "smol-toml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { COLOR_SCHEMES, CONVENTIONS, LANGUAGES, PACKAGE_MANAGERS, PYTHON_INDENTS, WEB_DESIGNS, split_header, type ProjectOptions } from "./config.ts";
import { file_state, git } from "./git.ts";
import { AGENTS_MD, ProjectError, commit_existing, inspect, regenerate, update, type Status } from "./project.ts";
import { TEMPLATE_HEADINGS } from "./render.ts";
import { join_sections, split_sections, type Section } from "./sections.ts";

/** @returns A file that is nothing but a header with `toml` as its options. */
function header(toml: string): string {
	return `<!-- clank-right\n${toml}\n-->\n\n`;
}

/** @returns The H1 headings of a managed file, in order. */
function headings_of(text: string): string[] {
	return split_sections(split_header(text)!.body).sections.map((section) => section.heading);
}

/**
 * Fails the test unless the repository needs regenerating, and narrows `status` so that the test can reach its
 * `rendered` text.
 * @param status What `inspect` said about the repository.
 */
function assert_dirty(status: Status): asserts status is Extract<Status, { kind: "dirty" }> {
	expect(status).toMatchObject({ kind: "dirty" });
}

const options_arb: Arbitrary<ProjectOptions> = record({
	languages:           uniqueArray(constantFrom(...LANGUAGES)),
	conventions:         constantFrom(...CONVENTIONS),
	package_manager:     constantFrom(...PACKAGE_MANAGERS),
	effection:           boolean(),
	libraries_extra:     array(constantFrom("`ventojs` for templating.", "`ws` for sockets."), { maxLength: 2 }),
	python_indent:       constantFrom(...PYTHON_INDENTS),
	web_design:          constantFrom(...WEB_DESIGNS),
	color_scheme:        constantFrom(...COLOR_SCHEMES),
	sandbox_note:        constantFrom("", "you're unable to hit production"),
	tools_extra:         array(constantFrom("ffmpeg", "nm", "natscli (bin: nats)"), { maxLength: 2 }),
	authorship_comments: boolean(),
});

const section_arb: Arbitrary<Section> = record({
	heading: constantFrom("Project map", "The app", "This fork", "Upstream conventions (still binding)"),
	body:    constantFrom("Text.", "- a/ - things\n- b/ - stuff", "## Sub\n\nMore.\n\n\tcode", "Gaps.\n\n\n\nWide.", "~~~\n# fenced\n\n\n~~~"),
});

/** The subject `update` gives its commit for the template version `version`. */
const subject = (version: string) => `${AGENTS_MD}: regenerate from clank-right template (${version})`;

/** A "custom" web design needs a section to keep, so the file gets one. */
const WEB_DESIGN_SECTION: Section = { heading: "Web design", body: "Bespoke rules.\n\n- one" };

describe("regenerate", () => {
	it("rejects a file without a header", async () => {
		await expect(regenerate("# Environment\n")).rejects.toThrow(ProjectError);
	});

	it("rejects text before the first heading", async () => {
		await expect(regenerate(header("") + "stray\n\n# Environment\n")).rejects.toThrow("text before the first heading");
	});

	it("rejects two sections with the same heading", async () => {
		await expect(regenerate(header("") + "# Notes\n\na\n\n# Notes\n\nb\n")).rejects.toThrow("two sections are titled \"Notes\"");
	});

	it("rejects a custom web design without a section to keep", async () => {
		await expect(regenerate(header("web_design = \"custom\"") + "# Environment\n")).rejects.toThrow("no \"# Web design\" section");
	});

	it("moves project sections into the slot and drops nothing of theirs", async () => {
		const file = header("languages = [\"rust\"]") + "# Project map\n\n- a/\n\n# Environment\n\nold\n\n# The app\n\nText.\n";
		const { rendered, dropped } = await regenerate(file);
		const headings = headings_of(rendered);
		expect(headings.slice(headings.indexOf("Thoughts for when there is programming involved"), headings.indexOf("Committing") + 1))
			.toEqual(["Thoughts for when there is programming involved", "Project map", "The app", "Committing"]);
		expect(rendered).toContain("# Project map\n\n- a/\n\n# The app\n\nText.\n\n# Committing");
		expect(dropped).toEqual([]);
	});

	it("reports template sections the options no longer produce", async () => {
		const file = header("") + "# Web design\n\nOld rules.\n\n# Working with Node projects\n\nnpm.\n";
		const { rendered, dropped } = await regenerate(file);
		expect(dropped).toEqual(["Web design", "Working with Node projects"]);
		expect(rendered).not.toContain("Old rules.");
	});

	it("drops a section under a heading the template used to emit instead of keeping it as the project's own", async () => {
		const file = header("") + "# Programming thoughts\n\nOld thoughts.\n";
		const { rendered, dropped } = await regenerate(file);
		expect(headings_of(rendered)).not.toContain("Programming thoughts");
		expect(rendered).not.toContain("Old thoughts.");
		expect(dropped).toEqual(["Programming thoughts"]);
	});

	it("drops the old After making changes section, leaving the project's Before committing right before Committing", async () => {
		const file = header("") + "# Before committing\n\n\tcargo test\n\n# After making changes\n\nOld checks.\n\nNever `git commit -a`.\n";
		const { rendered, dropped } = await regenerate(file);
		expect(dropped).toEqual(["After making changes"]);
		expect(rendered).toContain("# Before committing\n\n\tcargo test\n\n# Committing\n\n");
		expect(rendered).not.toContain("Old checks.");
	});

	it("keeps a custom Web design section in the template's place", async () => {
		const file = header("web_design = \"custom\"") + "# Web design\n\nBespoke.\n\n# Thoughts for when there is programming involved\n\nold\n";
		const { rendered } = await regenerate(file);
		const headings = headings_of(rendered);
		expect(headings.indexOf("Web design")).toBe(headings.indexOf("Thoughts for when there is programming involved") - 1);
		expect(rendered).toContain("# Web design\n\nBespoke.\n\n# Thoughts for when there is programming involved");
	});

	it("emits exactly the template headings when every option is on", async () => {
		const everything = "languages = [\"typescript\", \"c\", \"python\", \"sql\"]\nweb_design = \"2010\"";
		const { rendered } = await regenerate(header(everything));
		expect(new Set(headings_of(rendered))).toEqual(TEMPLATE_HEADINGS);
	});

	it("is a fixed point that keeps project text verbatim and never doubles blank lines", async () => {
		await assert(asyncProperty(options_arb, uniqueArray(section_arb, { selector: (s) => s.heading, maxLength: 3 }), async (options, sections) => {
			const own = options.web_design === "custom" ? [WEB_DESIGN_SECTION, ...sections] : sections;
			const file = header(stringify_toml(options)) + join_sections(own);
			const first = await regenerate(file);
			const second = await regenerate(first.rendered);
			expect(second.rendered).toBe(first.rendered);
			expect(second.dropped).toEqual([]);
			const split = split_header(first.rendered)!;
			expect(split.options_text).toBe(stringify_toml(options).trim());
			const kept = split_sections(split.body).sections.filter((s) => !TEMPLATE_HEADINGS.has(s.heading) || s.heading === "Web design");
			for (const section of own) {
				expect(kept).toContainEqual(section);
			}
			const template_owned = own.reduce((body, s) => body.replace(s.body, "(kept)"), split.body);
			expect(template_owned).not.toMatch(/\n{3,}/);
		}), { numRuns: 60 });
	});
});

describe("in a repository", () => {
	let repo: string;

	/** @returns The paths in the commit `ref` touches. */
	const touched = (ref: string) => git(repo, "show", "--name-only", "--format=", ref);
	const agents = () => join(repo, AGENTS_MD);
	const head_sha = () => git(repo, "rev-parse", "--short", "HEAD");

	beforeEach(async () => {
		repo = await mkdtemp(join(tmpdir(), "clank-right-"));
		await git(repo, "init", "--quiet", "--initial-branch=master");
		await git(repo, "config", "user.email", "test@example.com");
		await git(repo, "config", "user.name", "Test");
		await git(repo, "config", "commit.gpgsign", "false");
		await writeFile(join(repo, "other.txt"), "one\n");
		await writeFile(agents(), header("languages = [\"rust\"]") + "# Project map\n\n- a/\n");
		await git(repo, "add", "--all");
		await git(repo, "commit", "--quiet", "--message", "initial");
	});

	afterEach(async () => {
		await rm(repo, { recursive: true, force: true });
	});

	describe("update", () => {
		it("commits the regenerated AGENTS.md and nothing else", async () => {
			await writeFile(join(repo, "other.txt"), "two\n");
			await writeFile(join(repo, "junk.txt"), "junk\n");
			await git(repo, "add", "other.txt");

			const status = await inspect(repo);
			assert_dirty(status);
			const updated = await update(repo, status.rendered, "v1");
			expect(await touched("HEAD")).toBe(AGENTS_MD);
			expect(updated).toEqual({ kind: "committed", sha: await head_sha() });
			expect(await git(repo, "log", "--format=%s")).toBe(`${subject("v1")}\ninitial`);
			expect(await readFile(agents(), "utf8")).toBe(status.rendered);
			expect(await inspect(repo)).toEqual({ kind: "clean" });
			expect(await git(repo, "diff", "--cached", "--name-only")).toBe("other.txt");
			expect(await git(repo, "status", "--porcelain", "junk.txt")).toBe("?? junk.txt");
		});

		it("reports a regenerated file whose commit a hook rejected, instead of calling it clean", async () => {
			await writeFile(join(repo, ".git", "hooks", "pre-commit"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
			const status = await inspect(repo);
			assert_dirty(status);
			await expect(update(repo, status.rendered, "v1")).rejects.toThrow("regenerated and staged but not committed");
			expect(await readFile(agents(), "utf8")).toBe(status.rendered);
			expect(await inspect(repo)).toEqual({ kind: "uncommitted" });
			expect(await git(repo, "log", "--format=%s")).toBe("initial");
		});

		it("refuses when AGENTS.md has uncommitted changes", async () => {
			const before = await readFile(agents(), "utf8");
			await writeFile(agents(), before + "\n# Hand edit\n\nx\n");
			const status = await inspect(repo);
			assert_dirty(status);
			await expect(update(repo, status.rendered, "v1")).rejects.toThrow("uncommitted changes");
			expect(await readFile(agents(), "utf8")).toBe(before + "\n# Hand edit\n\nx\n");
		});

		it("commits a brand-new, untracked AGENTS.md", async () => {
			await git(repo, "rm", "--quiet", AGENTS_MD);
			await git(repo, "commit", "--quiet", "--message", "remove");
			expect(await inspect(repo)).toMatchObject({ kind: "error", message: expect.stringContaining("no AGENTS.md") });
			await writeFile(agents(), header(""));
			const status = await inspect(repo);
			assert_dirty(status);
			await update(repo, status.rendered, "v1");
			expect(await touched("HEAD")).toBe(AGENTS_MD);
			expect(await inspect(repo)).toEqual({ kind: "clean" });
		});

		describe("after an unpushed regeneration of its own", () => {
			/**
			 * Commits AGENTS.md as an earlier template version made it.
			 * @param text What that template made of the file.
			 * @param also More paths the commit changes, which an `update` never would.
			 * @returns The commit's short hash.
			 */
			async function commit_stale(text: string, ...also: string[]): Promise<string> {
				await writeFile(agents(), text);
				await git(repo, "commit", "--quiet", "--message", subject("v0"), "--", AGENTS_MD, ...also);
				return await head_sha();
			}

			it("amends it instead of piling another on top", async () => {
				const stale = await commit_stale(await readFile(agents(), "utf8") + "\n# Environment\n\nStale.\n");
				await writeFile(join(repo, "other.txt"), "two\n");
				await git(repo, "add", "other.txt");

				const status = await inspect(repo);
				assert_dirty(status);
				const updated = await update(repo, status.rendered, "v1");
				expect(updated).toEqual({ kind: "replaced", sha: await head_sha(), replaced: stale });
				expect(await git(repo, "log", "--format=%s")).toBe(`${subject("v1")}\ninitial`);
				expect(await touched("HEAD")).toBe(AGENTS_MD);
				expect(await inspect(repo)).toEqual({ kind: "clean" });
				expect(await git(repo, "diff", "--cached", "--name-only")).toBe("other.txt");
			});

			it("removes it when the file is back to what its parent had", async () => {
				const { rendered } = await regenerate(await readFile(agents(), "utf8"));
				await writeFile(agents(), rendered);
				await git(repo, "commit", "--quiet", "--message", "by hand", "--", AGENTS_MD);
				const stale_text = rendered.replace("# Environment\n\n", "# Environment\n\nStale.\n\n");
				expect(stale_text).not.toBe(rendered);
				const stale = await commit_stale(stale_text);
				await writeFile(join(repo, "other.txt"), "two\n");
				await git(repo, "add", "other.txt");

				const status = await inspect(repo);
				assert_dirty(status);
				expect(status.rendered).toBe(rendered);
				expect(await update(repo, status.rendered, "v1")).toEqual({ kind: "undone", replaced: stale });
				expect(await git(repo, "log", "--format=%s")).toBe("by hand\ninitial");
				expect(await inspect(repo)).toEqual({ kind: "clean" });
				expect(await git(repo, "status", "--porcelain")).toBe("M  other.txt");
			});

			it("piles another on top when another commit lands right after its own", async () => {
				await commit_stale(await readFile(agents(), "utf8") + "\n# Environment\n\nStale.\n");
				// Another session committing at the worst moment: between update's commit and its squash.
				const hook = join(repo, ".git", "hooks", "post-commit");
				await writeFile(hook, "#!/bin/sh\nrm \"$0\"\ngit commit --quiet --allow-empty --message other\n", { mode: 0o755 });
				const status = await inspect(repo);
				assert_dirty(status);
				const updated = await update(repo, status.rendered, "v1");
				expect(updated).toEqual({ kind: "committed", sha: await git(repo, "rev-parse", "--short", "HEAD^") });
				expect(await git(repo, "log", "--format=%s")).toBe(`other\n${subject("v1")}\n${subject("v0")}\ninitial`);
				expect(await inspect(repo)).toEqual({ kind: "clean" });
			});

			it("piles another on top once a remote-tracking branch has it", async () => {
				await commit_stale(await readFile(agents(), "utf8") + "\n# Environment\n\nStale.\n");
				await git(repo, "update-ref", "refs/remotes/origin/master", "HEAD");
				const status = await inspect(repo);
				assert_dirty(status);
				expect(await update(repo, status.rendered, "v1")).toEqual({ kind: "committed", sha: await head_sha() });
				expect(await git(repo, "log", "--format=%s")).toBe(`${subject("v1")}\n${subject("v0")}\ninitial`);
			});

			it("piles another on top when it changes more than AGENTS.md", async () => {
				await writeFile(join(repo, "other.txt"), "two\n");
				await commit_stale(await readFile(agents(), "utf8") + "\n# Environment\n\nStale.\n", "other.txt");
				const status = await inspect(repo);
				assert_dirty(status);
				expect(await update(repo, status.rendered, "v1")).toMatchObject({ kind: "committed" });
				expect(await git(repo, "log", "--format=%s")).toBe(`${subject("v1")}\n${subject("v0")}\ninitial`);
			});
		});
	});

	describe("commit_existing", () => {
		it("commits the edited AGENTS.md alone, so that update can follow with its own commit", async () => {
			const edited = (await readFile(agents(), "utf8")) + "\n# Hand edit\n\nx\n";
			await writeFile(agents(), edited);
			await writeFile(join(repo, "other.txt"), "two\n");
			await git(repo, "add", "other.txt");

			const existing = await commit_existing(repo, "hand edit");
			expect(existing).toBe(await git(repo, "rev-parse", "--short", "HEAD"));
			expect(await touched("HEAD")).toBe(AGENTS_MD);
			expect(await git(repo, "show", `HEAD:${AGENTS_MD}`)).toBe(edited.trim());
			expect(await file_state(repo, AGENTS_MD)).toBe("clean");
			expect(await git(repo, "diff", "--cached", "--name-only")).toBe("other.txt");

			const status = await inspect(repo);
			assert_dirty(status);
			await update(repo, status.rendered, "v1");
			expect(await git(repo, "log", "--format=%s")).toBe(`${subject("v1")}\nhand edit\ninitial`);
			expect(await touched("HEAD")).toBe(AGENTS_MD);
			expect(await readFile(agents(), "utf8")).toContain("# Hand edit\n\nx\n");
			expect(await inspect(repo)).toEqual({ kind: "clean" });
		});

		it("commits an untracked AGENTS.md", async () => {
			await git(repo, "rm", "--quiet", AGENTS_MD);
			await git(repo, "commit", "--quiet", "--message", "remove");
			await writeFile(agents(), header(""));
			expect(await commit_existing(repo, "add header")).not.toBeNull();
			expect(await touched("HEAD")).toBe(AGENTS_MD);
			expect(await git(repo, "log", "--format=%s", "-1")).toBe("add header");
			expect(await inspect(repo)).toMatchObject({ kind: "dirty" });
		});

		it("commits nothing when AGENTS.md matches HEAD", async () => {
			expect(await commit_existing(repo, "m")).toBeNull();
			expect(await git(repo, "log", "--format=%s")).toBe("initial");
		});

		it("commits nothing for a staged edit that the working tree reverted, and update still follows", async () => {
			const before = await readFile(agents(), "utf8");
			await writeFile(agents(), before + "\n# Staged\n\nx\n");
			await git(repo, "add", "--", AGENTS_MD);
			await writeFile(agents(), before);
			expect(await git(repo, "status", "--porcelain", "--", AGENTS_MD)).toBe(`MM ${AGENTS_MD}`);

			expect(await commit_existing(repo, "m")).toBeNull();
			expect(await git(repo, "log", "--format=%s")).toBe("initial");
			const status = await inspect(repo);
			assert_dirty(status);
			await update(repo, status.rendered, "v1");
			expect(await git(repo, "log", "--format=%s")).toBe(`${subject("v1")}\ninitial`);
			expect(await inspect(repo)).toEqual({ kind: "clean" });
		});
	});
});
