// Model-output: Claude Opus 5.5

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { CHATBOTS, chatbot_file, render_chatbot } from "./chatbots.ts";
import { DEFAULT_OPTIONS } from "./config.ts";
import { render, render_template } from "./render.ts";

describe("chatbots", () => {
	it.each(CHATBOTS)("chatbots/%s.md is what the templates render; `clank-right chatbots` rewrites it", async (chatbot) => {
		expect(await readFile(chatbot_file(chatbot), "utf8")).toBe(await render_chatbot(chatbot));
	});

	it("carry the partials that a TypeScript project's AGENTS.md shares with them", async () => {
		const agents_md = await render({ options_text: "", options: { ...DEFAULT_OPTIONS, languages: ["typescript"] }, project_sections: [], web_design_body: "" });
		for (const partial of ["push_back.vto", "programming_thoughts.vto", "code_conventions.vto"]) {
			const shared = await render_template(partial, { node: true, braces: true });
			expect(agents_md).toContain(shared);
			for (const chatbot of CHATBOTS) {
				expect(await render_chatbot(chatbot)).toContain(shared);
			}
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
