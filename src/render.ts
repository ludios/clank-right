// Model-output: Claude Fable 5.1
// Model-output: Claude Opus 5
// Model-output: Claude Opus 5.5
//
// Renders the templates: any of them as it is, and the master template into a
// complete AGENTS.md for one project. Knows which headings the master template
// owns, so that a project's own sections can be told from its.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { A } from "ayy";
import vento from "ventojs";
import auto_trim, { defaultTags } from "ventojs/plugins/auto_trim.js";
import { HEADER_OPEN, split_header, type ProjectOptions } from "./config.ts";
import { split_sections, type Section } from "./sections.ts";

/** This checkout of clank-right. */
export const TOOL_DIR = join(import.meta.dirname, "..");
const TEMPLATE_DIR = join(TOOL_DIR, "templates");
const TEMPLATE_FILE = "AGENTS.md.vto";

/**
 * @param source The master template's text.
 * @returns The headings it can emit: its literal `# ` lines after the header. The `# {{ section.heading }}` that
 * emits the project's own sections is not one.
 */
function template_headings(source: string): ReadonlySet<string> {
	const header_at = source.indexOf(`\n${HEADER_OPEN}\n`);
	A.neq(header_at, -1, "the template must open the header on a line of its own");
	const split = split_header(source.slice(header_at + 1));
	A(split !== null, "the template must close its header");
	const headings = split_sections(split.body).sections.map((section) => section.heading);
	return new Set(headings.filter((heading) => !heading.includes("{{")));
}

/** Headings the master template can emit, read from it once. */
export const TEMPLATE_HEADINGS: ReadonlySet<string> = template_headings(readFileSync(join(TEMPLATE_DIR, TEMPLATE_FILE), "utf8"));

/**
 * Headings the template used to emit. A file regenerated before a rename still has its section under the old
 * heading, which must go like any other template section instead of staying as the project's own.
 */
const FORMER_TEMPLATE_HEADINGS: ReadonlySet<string> = new Set([
	"Programming thoughts",
	"Codex code review after each commit",
	"After making changes",
]);

/**
 * @param heading An H1 heading in a managed file.
 * @returns Whether the section under it is the template's, to regenerate or drop, rather than the project's own, to
 * keep verbatim.
 */
export function is_template_heading(heading: string): boolean {
	return TEMPLATE_HEADINGS.has(heading) || FORMER_TEMPLATE_HEADINGS.has(heading);
}

const env = vento({ includes: TEMPLATE_DIR, strict: true });
// With `include` trimmed like the block tags, a partial included on a line of its own leaves no extra newline.
env.use(auto_trim({ tags: [...defaultTags, "include"] }));

/**
 * @param file A template's file name in templates/.
 * @param data The template's variables; with the environment's strict mode, it fails on any it uses but isn't given.
 * @returns The template's output, ending in one newline.
 */
export async function render_template(file: string, data: Record<string, unknown>): Promise<string> {
	const { content } = await env.run(file, data);
	return content.replace(/\n*$/, "\n");
}

export interface RenderInput {
	/** The project's TOML options as the human wrote them, to carry into the new header. */
	options_text: string;
	options: ProjectOptions;
	/** The project's own sections, in order. */
	project_sections: Section[];
	/** The existing "# Web design" body; used when options.web_design is "custom". */
	web_design_body: string;
}

/**
 * @returns The complete AGENTS.md text: the header, then the sections, ending in one newline. The template's own
 * whitespace is exact, so project-owned text (options, sections) passes through untouched.
 */
export async function render(input: RenderInput): Promise<string> {
	const data = {
		...input.options,
		options_text:     input.options_text.trim(),
		project_sections: input.project_sections,
		web_design_body:  input.web_design_body,
	};
	const content = await render_template(TEMPLATE_FILE, data);
	const open = HEADER_OPEN + "\n";
	A.eq(content.slice(0, open.length), open, "the template must begin with the header");
	return content;
}
