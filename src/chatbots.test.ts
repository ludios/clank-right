// Model-output: Claude Opus 5.5

import { readFile } from "node:fs/promises";
import { A } from "ayy";
import { describe, expect, it } from "vitest";
import { CHATBOTS, chatbot_file, render_chatbot } from "./chatbots.ts";
import { DEFAULT_OPTIONS, split_header } from "./config.ts";
import { render } from "./render.ts";
import { split_sections } from "./sections.ts";

describe("chatbots", () => {
	it.each(CHATBOTS)("chatbots/%s.md is what the templates render; `clank-right chatbots` rewrites it", async (chatbot) => {
		expect(await readFile(chatbot_file(chatbot), "utf8")).toBe(await render_chatbot(chatbot));
	});

	it("carry the code conventions that AGENTS.md gives a TypeScript project", async () => {
		const agents_md = await render({ options_text: "", options: { ...DEFAULT_OPTIONS, languages: ["typescript"] }, project_sections: [], web_design_body: "" });
		const split = split_header(agents_md);
		A(split !== null);
		const conventions = split_sections(split.body).sections.find((section) => section.heading === "Code conventions");
		A(conventions !== undefined);
		for (const chatbot of CHATBOTS) {
			expect(await render_chatbot(chatbot)).toContain(conventions.body);
		}
	});

	it("never leave trailing spaces or runs of blank lines, and end with one newline", async () => {
		for (const chatbot of CHATBOTS) {
			const text = await render_chatbot(chatbot);
			expect(text).toMatch(/^\S/);
			expect(text).not.toMatch(/[ \t]$/m);
			expect(text).not.toMatch(/\n{3,}/);
			expect(text.endsWith("\n")).toBe(true);
			expect(text.endsWith("\n\n")).toBe(false);
		}
	});
});
