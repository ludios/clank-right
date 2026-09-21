// Model-output: Claude Fable 5.1

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { array, assert, asyncProperty, boolean, constantFrom, record, uniqueArray, type Arbitrary } from "fast-check";
import { stringify as stringify_toml } from "smol-toml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CHECKS, COLOR_SCHEMES, COMMIT_STYLES, LANGUAGES, WEB_DESIGNS, split_header, type ProjectOptions } from "./config.ts";
import { git } from "./git.ts";
import { AGENTS_MD, ProjectError, inspect, regenerate, update } from "./project.ts";
import { TEMPLATE_HEADINGS, join_sections, split_sections, type Section } from "./sections.ts";

/** @returns A file that is nothing but a header with `toml` as its options. */
function header(toml: string): string {
	return `<!-- for-agents\n${toml}\n-->\n\n`;
}

/** @returns The H1 headings of a managed file, in order. */
function headings_of(text: string): string[] {
	return split_sections(split_header(text)!.body).sections.map((section) => section.heading);
}

const TEXT = constantFrom("", "A note.", "Two\n\nparagraphs, one with `code`.");

const options_arb: Arbitrary<ProjectOptions> = record({
	languages:       uniqueArray(constantFrom(...LANGUAGES)),
	effection:       boolean(),
	libraries_extra: array(constantFrom("`ventojs` for templating.", "`ws` for sockets."), { maxLength: 2 }),
	web_design:      constantFrom(...WEB_DESIGNS),
	color_scheme:    constantFrom(...COLOR_SCHEMES),
	sandbox_note:    constantFrom("", "you're unable to hit production"),
	tools_extra:     array(constantFrom("ffmpeg", "nm", "natscli (bin: nats)"), { maxLength: 2 }),
	checks:          uniqueArray(constantFrom(...CHECKS)),
	commit_style:    constantFrom(...COMMIT_STYLES),
	extra:           record({ environment: TEXT, authorship: TEXT, code_conventions: TEXT, web_design: TEXT, checks: TEXT }),
});

const section_arb: Arbitrary<Section> = record({
	heading: constantFrom("Project map", "The app", "This fork", "Upstream conventions (still binding)"),
	body:    constantFrom("Text.", "- a/ - things\n- b/ - stuff", "## Sub\n\nMore.\n\n\tcode", "Gaps.\n\n\n\nWide.", "~~~\n# fenced\n\n\n~~~"),
});

/** A "custom" web design needs a section to keep, so the file gets one. */
const WEB_DESIGN_SECTION: Section = { heading: "Web design", body: "Bespoke rules.\n\n- one" };

describe("regenerate", () => {
	it("rejects a file without a header", async () => {
		await expect(regenerate("# Environment\n")).rejects.toThrow(ProjectError);
	});

	it("rejects text before the first heading", async () => {
		await expect(regenerate(header("") + "stray\n\n# Environment\n")).rejects.toThrow("text before the first heading");
	});

	it("rejects a custom web design without a section to keep", async () => {
		await expect(regenerate(header("web_design = \"custom\"") + "# Environment\n")).rejects.toThrow("no \"# Web design\" section");
	});

	it("moves project sections into the slot and drops nothing of theirs", async () => {
		const file = header("languages = [\"rust\"]") + "# Project map\n\n- a/\n\n# Environment\n\nold\n\n# The app\n\nText.\n";
		const { rendered, dropped } = await regenerate(file);
		const headings = headings_of(rendered);
		expect(headings.slice(headings.indexOf("Programming thoughts"), headings.indexOf("After making changes") + 1))
			.toEqual(["Programming thoughts", "Project map", "The app", "After making changes"]);
		expect(rendered).toContain("# Project map\n\n- a/\n\n# The app\n\nText.\n\n# After making changes");
		expect(dropped).toEqual([]);
	});

	it("reports template sections the options no longer produce", async () => {
		const file = header("") + "# Web design\n\nOld rules.\n\n# Working with Node projects\n\nnpm.\n";
		const { rendered, dropped } = await regenerate(file);
		expect(dropped).toEqual(["Web design", "Working with Node projects"]);
		expect(rendered).not.toContain("Old rules.");
	});

	it("keeps a custom Web design section in the template's place", async () => {
		const file = header("web_design = \"custom\"") + "# Web design\n\nBespoke.\n\n# Programming thoughts\n\nold\n";
		const { rendered } = await regenerate(file);
		const headings = headings_of(rendered);
		expect(headings.indexOf("Web design")).toBe(headings.indexOf("Programming thoughts") - 1);
		expect(rendered).toContain("# Web design\n\nBespoke.\n\n# Programming thoughts");
	});

	it("emits exactly the template headings when every option is on", async () => {
		const everything = "languages = [\"typescript\", \"c\", \"sql\"]\nweb_design = \"2010\"\nchecks = [\"pnpm\"]";
		const { rendered } = await regenerate(header(everything));
		expect(new Set(headings_of(rendered))).toEqual(TEMPLATE_HEADINGS);
	});

	it("is a fixed point that keeps project text verbatim and never doubles blank lines", async () => {
		await assert(asyncProperty(options_arb, array(section_arb, { maxLength: 3 }), async (options, sections) => {
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

describe("update", () => {
	let repo: string;

	/** @returns The paths in the commit `ref` touches. */
	const touched = (ref: string) => git(repo, "show", "--name-only", "--format=", ref);
	const agents = () => join(repo, AGENTS_MD);

	beforeEach(async () => {
		repo = await mkdtemp(join(tmpdir(), "for-agents-"));
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

	it("commits the regenerated AGENTS.md and nothing else", async () => {
		await writeFile(join(repo, "other.txt"), "two\n");
		await writeFile(join(repo, "junk.txt"), "junk\n");
		await git(repo, "add", "other.txt");

		const status = await inspect(repo);
		expect(status.kind).toBe("dirty");
		if (status.kind !== "dirty") {
			return;
		}
		const sha = await update(repo, status.rendered, "AGENTS.md: regenerate");
		expect(await touched("HEAD")).toBe(AGENTS_MD);
		expect(await git(repo, "rev-parse", "--short", "HEAD")).toBe(sha);
		expect(await git(repo, "log", "--format=%s", "-1")).toBe("AGENTS.md: regenerate");
		expect(await readFile(agents(), "utf8")).toBe(status.rendered);
		expect(await inspect(repo)).toEqual({ kind: "clean" });
		expect(await git(repo, "diff", "--cached", "--name-only")).toBe("other.txt");
		expect(await git(repo, "status", "--porcelain", "junk.txt")).toBe("?? junk.txt");
	});

	it("reports a regenerated file whose commit a hook rejected, instead of calling it clean", async () => {
		await writeFile(join(repo, ".git", "hooks", "pre-commit"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
		const status = await inspect(repo);
		expect(status.kind).toBe("dirty");
		if (status.kind !== "dirty") {
			return;
		}
		await expect(update(repo, status.rendered, "m")).rejects.toThrow("regenerated and staged but not committed");
		expect(await readFile(agents(), "utf8")).toBe(status.rendered);
		expect(await inspect(repo)).toEqual({ kind: "uncommitted" });
		expect(await git(repo, "log", "--format=%s")).toBe("initial");
	});

	it("refuses when AGENTS.md has uncommitted changes", async () => {
		const before = await readFile(agents(), "utf8");
		await writeFile(agents(), before + "\n# Hand edit\n\nx\n");
		const status = await inspect(repo);
		expect(status.kind).toBe("dirty");
		if (status.kind !== "dirty") {
			return;
		}
		await expect(update(repo, status.rendered, "m")).rejects.toThrow("uncommitted changes");
		expect(await readFile(agents(), "utf8")).toBe(before + "\n# Hand edit\n\nx\n");
	});

	it("commits a brand-new, untracked AGENTS.md", async () => {
		await git(repo, "rm", "--quiet", AGENTS_MD);
		await git(repo, "commit", "--quiet", "--message", "remove");
		expect(await inspect(repo)).toMatchObject({ kind: "error", message: expect.stringContaining("no AGENTS.md") });
		await writeFile(agents(), header(""));
		const status = await inspect(repo);
		expect(status.kind).toBe("dirty");
		if (status.kind !== "dirty") {
			return;
		}
		await update(repo, status.rendered, "add");
		expect(await touched("HEAD")).toBe(AGENTS_MD);
		expect(await inspect(repo)).toEqual({ kind: "clean" });
	});
});
