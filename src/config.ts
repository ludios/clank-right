// Model-output: Claude Fable 5.1
//
// The `<!-- clank-right ... -->` header that starts every managed AGENTS.md.
// The tool owns the leading comment lines (how to regenerate the file); the
// project owns the TOML after them, which selects what the template emits.

import { parse as parse_toml } from "smol-toml";

export const LANGUAGES     = ["typescript", "javascript", "svelte", "rust", "c", "cpp", "go", "python", "nix", "zsh", "sql"] as const;
export const CHECKS        = ["sqlx", "pnpm", "cargo"] as const;
export const WEB_DESIGNS   = ["none", "2010", "custom"] as const;
export const COLOR_SCHEMES = ["light", "dark", "both"] as const;
export const COMMIT_STYLES = ["template", "nixpkgs"] as const;
const EXTRA_SLOTS          = ["environment", "code_conventions", "web_design", "checks"] as const;

type Language    = (typeof LANGUAGES)[number];
type Check       = (typeof CHECKS)[number];
type WebDesign   = (typeof WEB_DESIGNS)[number];
type ColorScheme = (typeof COLOR_SCHEMES)[number];
type CommitStyle = (typeof COMMIT_STYLES)[number];
type ExtraSlot   = (typeof EXTRA_SLOTS)[number];

/** What a project's header selects. Every field has a default, so the template can rely on all of them. */
export interface ProjectOptions {
	/** Languages that LLM-written code in the repository is likely to be in; they select the conventions, libraries, and checks. */
	languages: Language[];
	/** Whether the Node code uses effection, which adds it to "Libraries to use". */
	effection: boolean;
	/** Further "Libraries to use" items for the Node code, each as the text after the bullet, e.g. "`ventojs` for templating." */
	libraries_extra: string[];
	/** "2010" for the standard web design section, "custom" to keep the repository's own "# Web design" section, "none" for no section. */
	web_design: WebDesign;
	/** Which color schemes the "2010" web design must support. */
	color_scheme: ColorScheme;
	/** What being on a sandbox host implies here, e.g. "you're unable to hit production"; appended to the hostname bullet. */
	sandbox_note: string;
	/** Installed tools worth mentioning for this project, e.g. "ffmpeg", listed among the standard ones. */
	tools_extra: string[];
	/** Steps to run before committing, in order. */
	checks: Check[];
	/** "nixpkgs" replaces the commit template with nixpkgs-style commits. */
	commit_style: CommitStyle;
	/** Project-specific markdown (no H1 headings) to append at named points of the template; `web_design` applies to the "2010" design only. */
	extra: Record<ExtraSlot, string>;
}

/** The header can't be understood; the human has to fix it. */
export class OptionsError extends Error {}

export const DEFAULT_OPTIONS: Readonly<ProjectOptions> = {
	languages:       [],
	effection:       false,
	libraries_extra: [],
	web_design:      "none",
	color_scheme:    "both",
	sandbox_note:    "",
	tools_extra:     [],
	checks:          [],
	commit_style:    "template",
	extra: {
		environment:      "",
		code_conventions: "",
		web_design:       "",
		checks:           "",
	},
};

function describe_type(value: unknown): string {
	if (Array.isArray(value)) {
		return "an array";
	}
	return `a ${typeof value}`;
}

function expect_boolean(key: string, value: unknown): boolean {
	if (typeof value !== "boolean") {
		throw new OptionsError(`\`${key}\` must be true or false, not ${describe_type(value)}`);
	}
	return value;
}

function expect_string(key: string, value: unknown): string {
	if (typeof value !== "string") {
		throw new OptionsError(`\`${key}\` must be a string, not ${describe_type(value)}`);
	}
	return value;
}

/** A string that the template drops into the middle of a line, so it must not contain a newline. */
function expect_line(key: string, value: unknown): string {
	const text = expect_string(key, value);
	if (text.includes("\n")) {
		throw new OptionsError(`\`${key}\` must be a single line`);
	}
	return text;
}

function expect_line_list(key: string, value: unknown): string[] {
	if (!Array.isArray(value)) {
		throw new OptionsError(`\`${key}\` must be an array of strings`);
	}
	return value.map((item) => expect_line(key, item));
}

/**
 * Markdown the template inserts as its own content: an H1 in it would be taken for one of the project's own sections
 * on the next run and be emitted twice.
 */
function expect_markdown(key: string, value: unknown): string {
	const text = expect_string(key, value).trim();
	if (/^# /m.test(text)) {
		throw new OptionsError(`\`${key}\` must not contain a \`# \` heading line`);
	}
	return text;
}

function expect_one_of<T extends string>(key: string, value: unknown, allowed: readonly T[]): T {
	const text = expect_string(key, value);
	if (!(allowed as readonly string[]).includes(text)) {
		throw new OptionsError(`\`${key}\` must be one of ${allowed.map((a) => JSON.stringify(a)).join(", ")}, not ${JSON.stringify(text)}`);
	}
	return text as T;
}

function expect_list_of<T extends string>(key: string, value: unknown, allowed: readonly T[]): T[] {
	return expect_line_list(key, value).map((item) => expect_one_of(key, item, allowed));
}

function expect_extra(value: unknown): Record<ExtraSlot, string> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new OptionsError("`extra` must be a table");
	}
	const extra = { ...DEFAULT_OPTIONS.extra };
	for (const [slot, text] of Object.entries(value)) {
		if (!(EXTRA_SLOTS as readonly string[]).includes(slot)) {
			throw new OptionsError(`unknown \`extra\` slot \`${slot}\`; the slots are ${EXTRA_SLOTS.join(", ")}`);
		}
		extra[slot as ExtraSlot] = expect_markdown(`extra.${slot}`, text);
	}
	return extra;
}

/**
 * @param toml The project's options as written in its header; may be empty.
 * @returns The options with defaults filled in.
 * @throws OptionsError for malformed TOML, unknown keys, or values of the wrong shape.
 */
export function parse_options(toml: string): ProjectOptions {
	let raw: Record<string, unknown>;
	try {
		raw = parse_toml(toml);
	} catch (error) {
		throw new OptionsError(`the options are not valid TOML: ${error instanceof Error ? error.message : String(error)}`);
	}
	const options: ProjectOptions = { ...DEFAULT_OPTIONS, extra: { ...DEFAULT_OPTIONS.extra } };
	for (const [key, value] of Object.entries(raw)) {
		switch (key) {
			case "languages":
				options.languages = expect_list_of(key, value, LANGUAGES);
				break;
			case "effection":
				options.effection = expect_boolean(key, value);
				break;
			case "libraries_extra":
				options.libraries_extra = expect_line_list(key, value);
				break;
			case "web_design":
				options.web_design = expect_one_of(key, value, WEB_DESIGNS);
				break;
			case "color_scheme":
				options.color_scheme = expect_one_of(key, value, COLOR_SCHEMES);
				break;
			case "sandbox_note":
				options.sandbox_note = expect_line(key, value);
				break;
			case "tools_extra":
				options.tools_extra = expect_line_list(key, value);
				break;
			case "checks":
				options.checks = expect_list_of(key, value, CHECKS);
				break;
			case "commit_style":
				options.commit_style = expect_one_of(key, value, COMMIT_STYLES);
				break;
			case "extra":
				options.extra = expect_extra(value);
				break;
			default:
				throw new OptionsError(`unknown option \`${key}\``);
		}
	}
	return options;
}

export const HEADER_OPEN = "<!-- clank-right";
const HEADER_CLOSE = "-->";

interface SplitFile {
	/** The project's TOML options, without the tool's leading comment lines; may be empty. */
	options_text: string;
	/** Everything after the header's closing line. */
	body: string;
}

/**
 * @param inside The lines between the header's opening and closing lines.
 * @returns Those lines minus the leading comment and blank lines, which the tool regenerates.
 */
function strip_tool_comments(inside: string): string {
	const lines = inside.split("\n");
	let first = 0;
	while (first < lines.length && (lines[first]!.trim() === "" || lines[first]!.startsWith("#"))) {
		first++;
	}
	return lines.slice(first).join("\n").trim();
}

/**
 * @param text A whole AGENTS.md.
 * @returns Its header's options and the rest of the file, or null when the file doesn't start with a clank-right header.
 * @throws OptionsError when the header is opened but never closed.
 */
export function split_header(text: string): SplitFile | null {
	const open = HEADER_OPEN + "\n";
	if (!text.startsWith(open)) {
		return null;
	}
	const normalized = text.endsWith("\n") ? text : text + "\n";
	const close = "\n" + HEADER_CLOSE + "\n";
	const close_at = normalized.indexOf(close, HEADER_OPEN.length);
	if (close_at === -1) {
		throw new OptionsError(`the \`${HEADER_OPEN}\` header is never closed by a \`${HEADER_CLOSE}\` line`);
	}
	return {
		options_text: strip_tool_comments(normalized.slice(open.length, close_at + 1)),
		body:         normalized.slice(close_at + close.length),
	};
}
