// Model-output: Claude Fable 5.1
//
// AGENTS.md as a sequence of H1 sections, and which of them the template owns.

export interface Section {
	/** The H1 text, without the leading `# `. */
	heading: string;
	/** Everything up to the next H1, without surrounding blank lines. */
	body: string;
}

/** Headings the template can emit; any other H1 in a managed file is the project's own and is kept verbatim. */
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
	"Programming thoughts",
	"After making changes",
	"Codex code review after each commit",
	"Thank you for your hard work on this project",
]);

export interface SplitMarkdown {
	/** Text before the first H1, without surrounding blank lines; normally empty. */
	preamble: string;
	sections: Section[];
}

/** @returns `text` without leading and trailing newlines, keeping any indentation of its first line. */
function trim_newlines(text: string): string {
	return text.replace(/^\n+/, "").replace(/\n+$/, "");
}

/**
 * @param markdown The part of an AGENTS.md after its header.
 * @returns Its H1 sections in order. A `# ` line inside a ``` fence never starts a section.
 */
export function split_sections(markdown: string): SplitMarkdown {
	const preamble: string[] = [];
	const sections: Section[] = [];
	let heading: string | null = null;
	let lines: string[] = preamble;
	let in_fence = false;
	const finish = () => {
		if (heading !== null) {
			sections.push({ heading, body: trim_newlines(lines.join("\n")) });
		}
	};
	for (const line of markdown.split("\n")) {
		if (line.startsWith("```")) {
			in_fence = !in_fence;
		}
		if (!in_fence && line.startsWith("# ")) {
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
