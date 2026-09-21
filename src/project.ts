// Model-output: Claude Fable 5.1
//
// One managed repository: reading its AGENTS.md, deciding whether it matches
// the template, and committing a regenerated one.

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { A } from "ayy";
import { getLogger } from "@logtape/logtape";
import { OptionsError, parse_options, split_header } from "./config.ts";
import { GitError, commit_only, file_state } from "./git.ts";
import { render } from "./render.ts";
import { TEMPLATE_HEADINGS, split_sections } from "./sections.ts";

export const AGENTS_MD = "AGENTS.md";
const log = getLogger(["clank-right"]);

/** The file can't be regenerated as it is; the human has to act. */
export class ProjectError extends Error {}

export interface Regenerated {
	/** The AGENTS.md the template makes of the existing one. */
	rendered: string;
	/** Template-owned headings present in the existing file that the template no longer emits, so their content is about to disappear. */
	dropped: string[];
}

/**
 * @param current The existing AGENTS.md text.
 * @throws ProjectError or OptionsError when `current` isn't a managed file the template can rebuild.
 */
export async function regenerate(current: string): Promise<Regenerated> {
	const split = split_header(current);
	if (split === null) {
		throw new ProjectError("no `<!-- clank-right` header on line 1; see README.md");
	}
	const options = parse_options(split.options_text);
	const { preamble, sections } = split_sections(split.body);
	if (preamble !== "") {
		throw new ProjectError(`text before the first heading: ${JSON.stringify(preamble.slice(0, 60))}`);
	}
	const web_design = sections.find((section) => section.heading === "Web design");
	if (options.web_design === "custom" && web_design === undefined) {
		throw new ProjectError("web_design = \"custom\" but there is no \"# Web design\" section to keep");
	}
	const rendered = await render({
		options_text:     split.options_text,
		options,
		project_sections: sections.filter((section) => !TEMPLATE_HEADINGS.has(section.heading)),
		web_design_body:  web_design?.body ?? "",
	});
	const rendered_split = split_header(rendered);
	A(rendered_split !== null, "the template must emit the header it was given");
	const emitted = new Set(split_sections(rendered_split.body).sections.map((section) => section.heading));
	const dropped = sections
		.filter((section) => TEMPLATE_HEADINGS.has(section.heading) && !emitted.has(section.heading))
		.map((section) => section.heading);
	return { rendered, dropped };
}

export type Status =
	/** The file matches the template and is committed. */
	| { kind: "clean" }
	/** The file matches the template but differs from HEAD, e.g. after a commit that a hook rejected. */
	| { kind: "uncommitted" }
	| { kind: "dirty"; rendered: string; dropped: string[] }
	| { kind: "error"; message: string };

/**
 * @param dir The repository's working directory.
 * @returns Whether its AGENTS.md matches the template and is committed, or why that can't be decided.
 */
export async function inspect(dir: string): Promise<Status> {
	let current: string;
	try {
		current = await readFile(join(dir, AGENTS_MD), "utf8");
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") {
			return { kind: "error", message: `no ${AGENTS_MD}; create one with just a header (see README.md)` };
		}
		throw error;
	}
	try {
		const { rendered, dropped } = await regenerate(current);
		if (rendered !== current) {
			return { kind: "dirty", rendered, dropped };
		}
		const state = await file_state(dir, AGENTS_MD);
		return { kind: state === "clean" ? "clean" : "uncommitted" };
	} catch (error) {
		if (error instanceof ProjectError || error instanceof OptionsError) {
			return { kind: "error", message: error.message };
		}
		throw error;
	}
}

/**
 * Commits AGENTS.md as it is, alone, so that a regeneration can follow as its
 * own commit; whatever else is staged stays staged.
 * @param dir The repository's working directory.
 * @param message The commit message.
 * @returns The new commit's short hash, or null when AGENTS.md already matched HEAD and there was nothing to commit.
 * @throws GitError when git refuses the commit (a hook, signing); the file is then left staged.
 */
export async function commit_existing(dir: string, message: string): Promise<string | null> {
	const state = await file_state(dir, AGENTS_MD);
	if (state === "clean") {
		return null;
	}
	const sha = await commit_only(dir, AGENTS_MD, message);
	log.info("committed the {state} {file} as {sha} in {dir}", { state, file: AGENTS_MD, sha, dir });
	return sha;
}

/**
 * Writes the regenerated AGENTS.md and commits it alone.
 * @param dir The repository's working directory.
 * @param rendered The text to write, from `inspect`.
 * @param message The commit message.
 * @returns The new commit's short hash.
 * @throws ProjectError when AGENTS.md already has uncommitted changes, which the commit would otherwise sweep up
 * unreviewed, or when git refuses the commit (a hook, signing): the regenerated file is then left in place and
 * staged, and `inspect` reports it as "uncommitted" until the human commits it.
 */
export async function update(dir: string, rendered: string, message: string): Promise<string> {
	const state = await file_state(dir, AGENTS_MD);
	if (state === "modified") {
		throw new ProjectError(`${AGENTS_MD} has uncommitted changes; commit or stash them first, or pass --commit-existing-changes`);
	}
	await writeFile(join(dir, AGENTS_MD), rendered);
	let sha: string;
	try {
		sha = await commit_only(dir, AGENTS_MD, message);
	} catch (error) {
		if (error instanceof GitError) {
			throw new ProjectError(`${AGENTS_MD} was regenerated and staged but not committed; commit it yourself once this is fixed: ${error.message}`);
		}
		throw error;
	}
	log.info("committed {sha} in {dir}", { sha, dir });
	return sha;
}
