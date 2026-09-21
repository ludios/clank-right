// Model-output: Claude Fable 5.1

import { describe, expect, it } from "vitest";
import { DEFAULT_OPTIONS, OptionsError, parse_options, split_header } from "./config.ts";

describe("parse_options", () => {
	it("fills in defaults for an empty header", () => {
		expect(parse_options("")).toEqual(DEFAULT_OPTIONS);
		expect(parse_options("# just a comment\n")).toEqual(DEFAULT_OPTIONS);
	});

	it("reads every option", () => {
		const options = parse_options(`
languages       = ["typescript", "svelte", "sql"]
effection       = true
libraries_extra = ["ventojs for templating."]
web_design      = "2010"
color_scheme    = "dark"
sandbox_note    = "you're unable to hit production"
tools_extra     = ["natscli (bin: nats)", "nats-server"]
checks          = ["sqlx", "pnpm"]
commit_style    = "nixpkgs"

[extra]
environment = "  There's a questdb.  "
checks      = "plus the bank steps"
`);
		expect(options).toEqual({
			languages:       ["typescript", "svelte", "sql"],
			effection:       true,
			libraries_extra: ["ventojs for templating."],
			web_design:      "2010",
			color_scheme:    "dark",
			sandbox_note:    "you're unable to hit production",
			tools_extra:     ["natscli (bin: nats)", "nats-server"],
			checks:          ["sqlx", "pnpm"],
			commit_style:    "nixpkgs",
			extra: {
				environment:      "There's a questdb.",
				code_conventions: "",
				web_design:       "",
				checks:           "plus the bank steps",
			},
		});
	});

	it("does not share its defaults between calls", () => {
		const first = parse_options("[extra]\nchecks = \"x\"");
		expect(parse_options("").extra.checks).toBe("");
		expect(first.extra.checks).toBe("x");
	});

	it("rejects unknown keys, naming them", () => {
		expect(() => parse_options("has_web = true")).toThrow(OptionsError);
		expect(() => parse_options("has_web = true")).toThrow("unknown option `has_web`");
		expect(() => parse_options("[extra]\nbogus = \"x\"")).toThrow("unknown `extra` slot `bogus`");
	});

	it("rejects values outside the enums", () => {
		expect(() => parse_options("languages = [\"cobol\"]")).toThrow("`languages` must be one of");
		expect(() => parse_options("web_design = \"2015\"")).toThrow("`web_design` must be one of");
		expect(() => parse_options("checks = [\"make\"]")).toThrow(OptionsError);
		expect(() => parse_options("commit_style = \"svn\"")).toThrow(OptionsError);
	});

	it("rejects values of the wrong shape", () => {
		expect(() => parse_options("effection = \"yes\"")).toThrow("`effection` must be true or false");
		expect(() => parse_options("tools_extra = \"ffmpeg\"")).toThrow("`tools_extra` must be an array of strings");
		expect(() => parse_options("sandbox_note = 3")).toThrow("`sandbox_note` must be a string, not a number");
		expect(() => parse_options("extra = 3")).toThrow("`extra` must be a table");
		expect(() => parse_options("[extra]\nchecks = false")).toThrow("`extra.checks` must be a string");
	});

	it("rejects text the template could not place", () => {
		expect(() => parse_options("[extra]\nenvironment = \"# Special\\n\\nrule\"")).toThrow("`extra.environment` must not contain a `# ` heading line");
		expect(() => parse_options("sandbox_note = \"two\\nlines\"")).toThrow("`sandbox_note` must be a single line");
		expect(() => parse_options("tools_extra = [\"a\\nb\"]")).toThrow("`tools_extra` must be a single line");
		expect(() => parse_options("libraries_extra = [\"a\\nb\"]")).toThrow("`libraries_extra` must be a single line");
		expect(parse_options("[extra]\nenvironment = \"## fine\\n\\n\\t# code\"").extra.environment).toBe("## fine\n\n\t# code");
	});

	it("rejects malformed TOML", () => {
		expect(() => parse_options("languages = [")).toThrow("not valid TOML");
	});
});

describe("split_header", () => {
	it("returns null when the file does not start with a header", () => {
		expect(split_header("# Environment\n")).toBeNull();
		expect(split_header("\n<!-- clank-right\n-->\n")).toBeNull();
		expect(split_header("<!-- clank-right -->\n")).toBeNull();
	});

	it("separates the tool's comment lines from the options and the body", () => {
		const text = "<!-- clank-right\n# generated, see README\n# more\n\nlanguages = [\"rust\"]\n# a note on checks\nchecks = [\"cargo\"]\n-->\n\n# Environment\n\nHi.\n";
		expect(split_header(text)).toEqual({
			options_text: "languages = [\"rust\"]\n# a note on checks\nchecks = [\"cargo\"]",
			body:         "\n# Environment\n\nHi.\n",
		});
	});

	it("handles a header with nothing but the tool's comments", () => {
		expect(split_header("<!-- clank-right\n# generated\n-->\n# Environment\n")).toEqual({ options_text: "", body: "# Environment\n" });
		expect(split_header("<!-- clank-right\n-->\n")).toEqual({ options_text: "", body: "" });
	});

	it("tolerates a missing final newline", () => {
		expect(split_header("<!-- clank-right\nx = 1\n-->")).toEqual({ options_text: "x = 1", body: "" });
	});

	it("throws when the header is never closed", () => {
		expect(() => split_header("<!-- clank-right\nx = 1\n\n# Environment\n")).toThrow(OptionsError);
	});
});
