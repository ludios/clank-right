// Model-output: Claude Opus 5.5
//
// The account-wide instructions for the chatbots: templates/chatbot.vto,
// rendered into chatbots/ in this checkout. Neither chatbot has an API for
// these settings, so the human pastes each file into its settings page.

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { A } from "ayy";
import { TOOL_DIR, render_template } from "./render.ts";

export const CHATBOTS = ["claude", "chatgpt"] as const;

type Chatbot = (typeof CHATBOTS)[number];

/**
 * The most characters each chatbot's settings accept. ChatGPT's custom instructions take 5,000 on the paid plans
 * (1,500 on Free and Go); claude.ai documents no limit for "Instructions for Claude".
 */
const MAX_LENGTH: Record<Chatbot, number> = {
	claude:  Infinity,
	chatgpt: 5000,
};

/** @returns The path of the file that holds `chatbot`'s instructions. */
export function chatbot_file(chatbot: Chatbot): string {
	return join(TOOL_DIR, "chatbots", `${chatbot}.md`);
}

/**
 * @returns `chatbot`'s instructions, ending in one newline.
 * @throws AssertionError when they are longer than its settings accept.
 */
export async function render_chatbot(chatbot: Chatbot): Promise<string> {
	const text = await render_template("chatbot.vto", { claude: chatbot === "claude" });
	A.lte(text.length, MAX_LENGTH[chatbot], `${chatbot}'s instructions must fit its settings`);
	return text;
}

/**
 * Rewrites `chatbot`'s file from the template.
 * @returns The text written.
 */
export async function write_chatbot(chatbot: Chatbot): Promise<string> {
	const text = await render_chatbot(chatbot);
	const file = chatbot_file(chatbot);
	await mkdir(dirname(file), { recursive: true });
	await writeFile(file, text);
	return text;
}
