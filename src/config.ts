// Model-output: Claude Fable 5.1
// Model-output: Claude Opus 5.5
//
// The `<!-- clank-right ... -->` header that starts every managed AGENTS.md.
// The tool owns the leading comment lines (how to regenerate the file); the
// project owns the TOML after them, which selects what the template emits.

import { parse as parse_toml } from "smol-toml";

export const LANGUAGES        = ["typescript", "javascript", "svelte", "rust", "c", "cpp", "csharp", "go", "python", "nix", "zsh", "sql"] as const;
export const CONVENTIONS      = ["ours", "upstream"] as const;
export const PACKAGE_MANAGERS = ["pnpm", "bun"] as const;
export const PYTHON_INDENTS   = ["spaces", "tabs"] as const;
export const WEB_DESIGNS      = ["none", "2010", "custom"] as const;
export const COLOR_SCHEMES    = ["light", "dark", "both"] as const;

type Language       = (typeof LANGUAGES)[number];
type Conventions    = (typeof CONVENTIONS)[number];
type PackageManager = (typeof PACKAGE_MANAGERS)[number];
type PythonIndent   = (typeof PYTHON_INDENTS)[number];
type WebDesign      = (typeof WEB_DESIGNS)[number];
type ColorScheme    = (typeof COLOR_SCHEMES)[number];

/** What a project's header selects. Every field has a default, so the template can rely on all of them. */
export interface ProjectOptions {
	/** Languages that LLM-written code in the repository is likely to be in; they select the conventions and libraries. */
	languages: Language[];
	/**
	 * "upstream" for a fork that follows upstream's conventions: "Code conventions" is then left out, "Libraries to
	 * use" holds only libraries_extra, and effection and python_indent do nothing.
	 */
	conventions: Conventions;
	/** The package manager that the Node code's lockfile belongs to; "Working with Node projects" tells agents to use it. */
	package_manager: PackageManager;
	/** Whether the Node code uses effection, which adds it to "Libraries to use". */
	effection: boolean;
	/** Further "Libraries to use" items, listed after the standard ones, each as the text after the bullet, e.g. "`ventojs` for templating." */
	libraries_extra: string[];
	/** How the Python code is indented: "spaces" (four, as PEP 8 says) or "tabs", for the older projects written that way. */
	python_indent: PythonIndent;
	/** "2010" for the standard web design section, "custom" to keep the repository's own "# Web design" section, "none" for no section. */
	web_design: WebDesign;
	/** Which color schemes the "2010" web design must support. */
	color_scheme: ColorScheme;
	/** What being on a sandbox host implies here, e.g. "you're unable to hit production"; appended to the hostname bullet. */
	sandbox_note: string;
	/** Installed tools worth mentioning for this project, e.g. "ffmpeg", listed among the standard ones. */
	tools_extra: string[];
}

/** The header can't be understood; the human has to fix it. */
export class OptionsError extends Error {}

export const DEFAULT_OPTIONS: Readonly<ProjectOptions> = {
	languages:       [],
	conventions:     "ours",
	package_manager: "pnpm",
	effection:       false,
	libraries_extra: [],
	python_indent:   "spaces",
	web_design:      "none",
	color_scheme:    "both",
	sandbox_note:    "",
	tools_extra:     [],
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
	const options: ProjectOptions = { ...DEFAULT_OPTIONS };
	for (const [key, value] of Object.entries(raw)) {
		switch (key) {
			case "languages":
				options.languages = expect_list_of(key, value, LANGUAGES);
				break;
			case "conventions":
				options.conventions = expect_one_of(key, value, CONVENTIONS);
				break;
			case "package_manager":
				options.package_manager = expect_one_of(key, value, PACKAGE_MANAGERS);
				break;
			case "effection":
				options.effection = expect_boolean(key, value);
				break;
			case "libraries_extra":
				options.libraries_extra = expect_line_list(key, value);
				break;
			case "python_indent":
				options.python_indent = expect_one_of(key, value, PYTHON_INDENTS);
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
