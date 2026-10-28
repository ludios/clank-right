// Model-output: Claude Fable 5.1
// Model-output: Claude Opus 5.5
//
// One managed repository: reading its AGENTS.md, deciding whether it matches
// the template, and committing a regenerated one.

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { A } from "ayy";
import { getLogger } from "@logtape/logtape";
import { OptionsError, parse_options, split_header } from "./config.ts";
import { GitError, commit_only, file_state, git, head_commit, move_head, other_refs_containing_head, squash_head_into } from "./git.ts";
import { is_template_heading, render } from "./render.ts";
import { split_sections } from "./sections.ts";

export const AGENTS_MD = "AGENTS.md";
/** The subject of every commit `update` makes, up to the template's version in parentheses. */
const UPDATE_SUBJECT = `${AGENTS_MD}: regenerate from clank-right template`;
const log = getLogger(["clank-right"]);

/** The file can't be regenerated as it is; the human has to act. */
export class ProjectError extends Error {}

interface Regenerated {
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
	const repeated = sections.find((section, i) => sections.slice(0, i).some((earlier) => earlier.heading === section.heading));
	if (repeated !== undefined) {
		throw new ProjectError(`two sections are titled ${JSON.stringify(repeated.heading)}`);
	}
	const web_design = sections.find((section) => section.heading === "Web design");
	if (options.web_design === "custom" && web_design === undefined) {
		throw new ProjectError("web_design = \"custom\" but there is no \"# Web design\" section to keep");
	}
	const rendered = await render({
		options_text:     split.options_text,
		options,
		project_sections: sections.filter((section) => !is_template_heading(section.heading)),
		web_design_body:  web_design?.body ?? "",
	});
	const rendered_split = split_header(rendered);
	A(rendered_split !== null, "the template must emit the header it was given");
	const emitted_headings = split_sections(rendered_split.body).sections.map((section) => section.heading);
	const emitted = new Set(emitted_headings);
	A.eq(emitted.size, emitted_headings.length, "a heading was emitted twice: does TEMPLATE_HEADINGS miss one the template emits?");
	const dropped = sections
		.filter((section) => is_template_heading(section.heading) && !emitted.has(section.heading))
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
 * @param dir The repository's working directory.
 * @returns HEAD's short hash when HEAD is a commit `update` made, changing only AGENTS.md, that no ref but the
 * checked-out branch has, i.e. as far as this clone knows, it hasn't been pushed. A newer regeneration can then
 * replace it instead of piling up on it. Otherwise null.
 */
async function replaceable_head(dir: string): Promise<string | null> {
	const head = await head_commit(dir);
	if (head === null || !head.subject.startsWith(`${UPDATE_SUBJECT} (`)) {
		return null;
	}
	if (head.parents.length !== 1 || head.paths.length !== 1 || head.paths[0] !== AGENTS_MD) {
		log.info("{sha} in {dir} has the subject of a regeneration but changes {paths} with {parents} parents; not replacing it", {
			sha: head.sha, dir, paths: head.paths, parents: head.parents.length,
		});
		return null;
	}
	const refs = await other_refs_containing_head(dir);
	if (refs.length > 0) {
		log.info("not replacing {sha} in {dir}, which {refs} also contain", { sha: head.sha, dir, refs });
		return null;
	}
	return head.sha;
}

/** What `update` did to the checked-out branch. */
export type Updated =
	| { kind: "committed"; sha: string }
	/** HEAD was `replaced`, an unpushed regeneration; `sha` replaces it, holding both changes. */
	| { kind: "replaced"; sha: string; replaced: string }
	/** HEAD was `replaced`, an unpushed regeneration, and the file is back to what its parent had, so it's gone. */
	| { kind: "undone"; replaced: string };

/**
 * Removes `replaceable` from the branch if the regenerated file is back to what its parent had; whatever else is
 * staged stays staged.
 * @param dir The repository's working directory.
 * @param replaceable HEAD's short hash, from `replaceable_head`.
 * @returns Whether it did; false when the file differs from the parent's, or HEAD has moved off `replaceable`.
 */
async function undo(dir: string, replaceable: string): Promise<boolean> {
	if (await git(dir, "diff", "--name-only", `${replaceable}^`, "--", AGENTS_MD) !== "") {
		return false;
	}
	if (!await move_head(dir, `${replaceable}^`, replaceable, `clank-right: undo ${replaceable}`)) {
		return false;
	}
	await git(dir, "add", "--", AGENTS_MD);
	log.info("undid {sha} in {dir}, since {file} is back to what its parent had", { sha: replaceable, dir, file: AGENTS_MD });
	return true;
}

/**
 * Writes the regenerated AGENTS.md and commits it alone. If HEAD is an unpushed commit of this function's, squashes
 * the new commit into that one, or removes that one when the file is back to what its parent had. Either happens
 * only if no other commit has landed on the branch meanwhile; otherwise the new commit stays a commit of its own.
 * Whatever else is staged stays staged.
 * @param dir The repository's working directory.
 * @param rendered The text to write, from `inspect`.
 * @param version Which template made `rendered`, for the commit message.
 * @returns What happened to the branch.
 * @throws ProjectError when AGENTS.md already has uncommitted changes, which the commit would otherwise sweep up
 * unreviewed, or when git refuses the commit (a hook, signing): the regenerated file is then left in place and
 * staged, and `inspect` reports it as "uncommitted" until the human commits it.
 */
export async function update(dir: string, rendered: string, version: string): Promise<Updated> {
	const state = await file_state(dir, AGENTS_MD);
	if (state === "modified") {
		throw new ProjectError(`${AGENTS_MD} has uncommitted changes; commit or stash them first, or pass --commit-existing-changes`);
	}
	const replaceable = await replaceable_head(dir);
	await writeFile(join(dir, AGENTS_MD), rendered);
	if (replaceable !== null && await undo(dir, replaceable)) {
		return { kind: "undone", replaced: replaceable };
	}
	let sha: string;
	try {
		sha = await commit_only(dir, AGENTS_MD, `${UPDATE_SUBJECT} (${version})`);
	} catch (error) {
		if (error instanceof GitError) {
			throw new ProjectError(`${AGENTS_MD} was regenerated and staged but not committed; commit it yourself once this is fixed: ${error.message}`);
		}
		throw error;
	}
	if (replaceable !== null) {
		const squashed = await squash_head_into(dir, sha, replaceable);
		if (squashed !== null) {
			log.info("committed {sha} in {dir}, replacing {replaced}", { sha: squashed, dir, replaced: replaceable });
			return { kind: "replaced", sha: squashed, replaced: replaceable };
		}
	}
	log.info("committed {sha} in {dir}", { sha, dir });
	return { kind: "committed", sha };
}
