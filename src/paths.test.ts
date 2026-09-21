// Model-output: Claude Opus 5

import { homedir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { config_home } from "./paths.ts";

const DEFAULT = join(homedir(), ".config");

afterEach(() => {
	delete process.env["XDG_CONFIG_HOME"];
});

describe("config_home", () => {
	it("falls back to ~/.config when XDG_CONFIG_HOME says nothing", () => {
		delete process.env["XDG_CONFIG_HOME"];
		expect(config_home()).toBe(DEFAULT);
		process.env["XDG_CONFIG_HOME"] = "";
		expect(config_home()).toBe(DEFAULT);
	});

	it("uses an absolute XDG_CONFIG_HOME", () => {
		process.env["XDG_CONFIG_HOME"] = "/var/lib/someone/config";
		expect(config_home()).toBe("/var/lib/someone/config");
	});

	it("ignores a relative XDG_CONFIG_HOME, as the specification requires", () => {
		process.env["XDG_CONFIG_HOME"] = "config";
		expect(config_home()).toBe(DEFAULT);
		process.env["XDG_CONFIG_HOME"] = "~/config";
		expect(config_home()).toBe(DEFAULT);
	});
});
