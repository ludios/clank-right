// Model-output: Claude Fable 5.1
// Model-output: Claude Opus 5.5
//
// AGENTS.md as a sequence of H1 sections, and which of them the template owns.

export interface Section {
	/** The H1 text, without the leading `# `. */
	heading: string;
	/** Everything up to the next H1, without surrounding blank lines. */
	body: string;
}

/** Headings the template can emit. */
export const TEMPLATE_HEADINGS: ReadonlySet<string> = new Set([
	"Environment",
	"Avoid consuming tokens in excess",
	"The user isn't always right",
	"Working with Node projects",
	"There's plenty of time",
	"Tracking AI authorship",
	"Code conventions",
	"Libraries to use",
	"Web design",
	"Thoughts for when there is programming involved",
	"After making changes",
	"Codex code review after each commit",
	"Thank you for your hard work on this project",
]);

/**
 * Headings the template used to emit. A file regenerated before a rename still has its section under the old
 * heading, which must go like any other template section instead of staying as the project's own.
 */
const FORMER_TEMPLATE_HEADINGS: ReadonlySet<string> = new Set([
	"Programming thoughts",
]);

/**
 * @param heading An H1 heading in a managed file.
 * @returns Whether the section under it is the template's, to regenerate or drop, rather than the project's own, to
 * keep verbatim.
 */
export function is_template_heading(heading: string): boolean {
	return TEMPLATE_HEADINGS.has(heading) || FORMER_TEMPLATE_HEADINGS.has(heading);
}

interface SplitMarkdown {
	/** Text before the first H1, without surrounding blank lines; normally empty. */
	preamble: string;
	sections: Section[];
}

/** @returns `text` without leading and trailing newlines, keeping any indentation of its first line. */
function trim_newlines(text: string): string {
	return text.replace(/^\n+/, "").replace(/\n+$/, "");
}

/** A code fence opener or closer: three or more backticks or tildes, indented at most three spaces. */
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/**
 * @param markdown The part of an AGENTS.md after its header.
 * @returns Its H1 sections in order. A `# ` line inside a code fence never starts a section; a fence closes only at a line of the same character at least as long, as in CommonMark.
 */
export function split_sections(markdown: string): SplitMarkdown {
	const preamble: string[] = [];
	const sections: Section[] = [];
	let heading: string | null = null;
	let lines: string[] = preamble;
	let fence: string | null = null;
	const finish = () => {
		if (heading !== null) {
			sections.push({ heading, body: trim_newlines(lines.join("\n")) });
		}
	};
	for (const line of markdown.split("\n")) {
		const marker = FENCE.exec(line)?.[1];
		if (fence === null && marker !== undefined) {
			fence = marker;
		} else if (fence !== null && marker !== undefined && marker[0] === fence[0] && marker.length >= fence.length) {
			fence = null;
		} else if (fence === null && line.startsWith("# ")) {
			finish();
			heading = line.slice(2).trim();
			lines = [];
			continue;
		}
		lines.push(line);
	}
	finish();
	return { preamble: trim_newlines(preamble.join("\n")), sections };
}

/**
 * @param sections Sections in the order they should appear.
 * @returns Markdown with one blank line between a heading, its body, and the next heading; the inverse of `split_sections` for well-formed sections.
 */
export function join_sections(sections: readonly Section[]): string {
	return sections.map((section) => `# ${section.heading}\n\n${section.body}\n`).join("\n");
}
