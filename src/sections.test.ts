// Model-output: Claude Fable 5.1

import { array, assert, constantFrom, property, record, tuple, type Arbitrary } from "fast-check";
import { describe, expect, it } from "vitest";
import { join_sections, split_sections, type Section } from "./sections.ts";

const BODY_LINES = ["A paragraph.", "- a bullet", "\tcode block", "## Subheading", "More text with `code` and {{ braces }}."];

/** A section as the template or a human would write it: no blank lines around the body, no H1 or fence inside it. */
const section_arb: Arbitrary<Section> = record({
	heading: array(constantFrom("Project", "map", "The", "app's", "fork", "(still binding)"), { minLength: 1, maxLength: 4 })
		.map((words) => words.join(" ")),
	body: array(tuple(constantFrom(...BODY_LINES), constantFrom("\n", "\n\n")), { minLength: 1, maxLength: 6 })
		.map((pairs) => pairs.map(([line, gap], i) => (i === pairs.length - 1 ? line : line + gap)).join("")),
});

describe("split_sections", () => {
	it("splits H1 sections and trims blank lines around bodies", () => {
		const text = "\n# One\n\nfirst\n\n\n# Two\ntwo has\n\n- a list\n\n";
		expect(split_sections(text)).toEqual({
			preamble: "",
			sections: [
				{ heading: "One", body: "first" },
				{ heading: "Two", body: "two has\n\n- a list" },
			],
		});
	});

	it("keeps H2 headings and `# ` lines inside fences in the body", () => {
		const text = "# One\n\n## Sub\n\n```sh\n# not a heading\n```\n\n# Two\n\nx\n";
		expect(split_sections(text).sections).toEqual([
			{ heading: "One", body: "## Sub\n\n```sh\n# not a heading\n```" },
			{ heading: "Two", body: "x" },
		]);
	});

	it("keeps the indentation of a body's first line", () => {
		expect(split_sections("# One\n\n\tcode\n").sections[0]!.body).toBe("\tcode");
	});

	it("collects text before the first heading as the preamble", () => {
		expect(split_sections("\nhello\n\n# One\n\nx\n")).toEqual({ preamble: "hello", sections: [{ heading: "One", body: "x" }] });
		expect(split_sections("")).toEqual({ preamble: "", sections: [] });
	});

	it("inverts join_sections", () => {
		assert(property(array(section_arb, { maxLength: 5 }), (sections) => {
			expect(split_sections(join_sections(sections))).toEqual({ preamble: "", sections });
		}));
	});
});
