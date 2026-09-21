// Model-output: Claude Fable 5.1
// Model-output: Claude Opus 5
//
// Renders the master template into a complete AGENTS.md for one project.

import { join } from "node:path";
import { A } from "ayy";
import vento from "ventojs";
import auto_trim from "ventojs/plugins/auto_trim.js";
import { HEADER_OPEN, type ProjectOptions } from "./config.ts";
import type { Section } from "./sections.ts";

/** This checkout of clank-right. */
export const TOOL_DIR = join(import.meta.dirname, "..");
export const TEMPLATE_DIR = join(TOOL_DIR, "templates");
export const TEMPLATE_FILE = "AGENTS.md.vto";

const env = vento({ includes: TEMPLATE_DIR, strict: true });
env.use(auto_trim());

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
	const { content } = await env.run(TEMPLATE_FILE, data);
	const open = HEADER_OPEN + "\n";
	A.eq(content.slice(0, open.length), open, "the template must begin with the header");
	return content.replace(/\n*$/, "\n");
}
