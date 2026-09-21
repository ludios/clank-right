// Model-output: Claude Fable 5.1
// Model-output: Claude Opus 5
//
// Home-relative paths, as humans write them in projects.txt and want to read
// them in the tool's output, plus where that file lives.

import { homedir } from "node:os";
import { join, resolve } from "node:path";

/**
 * @param path A path as a human wrote it: possibly `~`-relative, possibly relative to the working directory.
 * @returns The same path, absolute.
 */
export function untilde(path: string): string {
	if (path === "~" || path.startsWith("~/")) {
		return resolve(homedir(), path.slice(2));
	}
	return resolve(path);
}

/**
 * @returns The directory holding per-user configuration: `$XDG_CONFIG_HOME` when it is set to an absolute path, as
 * the XDG base directory specification requires, and `~/.config` otherwise.
 */
export function config_home(): string {
	const xdg = process.env["XDG_CONFIG_HOME"];
	if (xdg !== undefined && xdg.startsWith("/")) {
		return xdg;
	}
	return join(homedir(), ".config");
}

/**
 * @param path An absolute path.
 * @returns The same path with the home directory abbreviated to `~`, when it is under it.
 */
export function tilde(path: string): string {
	const home = homedir();
	if (path === home) {
		return "~";
	}
	if (path.startsWith(home + "/")) {
		return "~" + path.slice(home.length);
	}
	return path;
}
