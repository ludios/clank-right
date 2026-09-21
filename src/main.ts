// Model-output: Claude Fable 5.1
// Model-output: Claude Opus 5
//
// The command line: `clank-right check` reports which repositories' AGENTS.md
// no longer match the template; `clank-right update` regenerates and commits
// the ones that don't.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { ansiColorFormatter, configureSync, getConsoleSink } from "@logtape/logtape";
import { GitError, describe } from "./git.ts";
import { config_home, tilde, untilde } from "./paths.ts";
import { run_process } from "./process.ts";
import { AGENTS_MD, ProjectError, inspect, update, type Status } from "./project.ts";
import { TOOL_DIR } from "./render.ts";

const PROJECTS_FILE = join(config_home(), "clank-right", "projects.txt");

const USAGE = `clank-right check [--diff] [DIR...]
clank-right update [DIR...]

check   Report which repositories' ${AGENTS_MD} differ from what the template
        generates, or are not committed; --diff shows how. Exits 1 if any.
update  Regenerate each differing ${AGENTS_MD} and commit it, alone.

DIR defaults to every repository listed in ${tilde(PROJECTS_FILE)}.
--verbose logs each git invocation.`;

interface Cli {
	command: "check" | "update";
	dirs: string[];
	diff: boolean;
	verbose: boolean;
}

/** Nothing can be run: the command line makes no sense, or the projects file is missing. The message says which. */
class UsageError extends Error {}

/**
 * @param argv Raw arguments after the program name.
 * @returns The parsed command line.
 * @throws UsageError for anything else.
 */
function parse_cli(argv: string[]): Cli {
	const { values, positionals } = parseArgs({
		args: argv,
		allowPositionals: true,
		options: {
			"diff":    { type: "boolean", default: false },
			"verbose": { type: "boolean", default: false },
			"help":    { type: "boolean", default: false },
		},
	});
	const [command, ...dirs] = positionals;
	if (values.help || command === undefined) {
		throw new UsageError(USAGE);
	}
	if (command !== "check" && command !== "update") {
		throw new UsageError(`unknown command ${JSON.stringify(command)}\n\n${USAGE}`);
	}
	if (values.diff && command !== "check") {
		throw new UsageError(`--diff only applies to check\n\n${USAGE}`);
	}
	return { command, dirs, diff: values.diff, verbose: values.verbose };
}

/**
 * @param dirs Repositories named on the command line, as written.
 * @returns Absolute paths of the repositories to work on: `dirs`, or every entry of the projects file when there are none.
 * @throws UsageError when there are no `dirs` and no projects file.
 */
async function project_dirs(dirs: string[]): Promise<string[]> {
	if (dirs.length > 0) {
		return dirs.map(untilde);
	}
	let text: string;
	try {
		text = await readFile(PROJECTS_FILE, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
			throw error;
		}
		throw new UsageError(`no ${tilde(PROJECTS_FILE)}; create it, one repository per line, or name the repositories on the command line`);
	}
	return text
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line !== "" && !line.startsWith("#"))
		.map(untilde);
}

/**
 * @param dir The repository's working directory.
 * @param rendered What its AGENTS.md should contain.
 * @returns A unified diff from the current file to `rendered`, from diff(1).
 */
async function unified_diff(dir: string, rendered: string): Promise<string> {
	const labels = ["--label", `a/${AGENTS_MD}`, "--label", `b/${AGENTS_MD}`];
	const result = await run_process("diff", ["-u", ...labels, join(dir, AGENTS_MD), "-"], rendered);
	if (result.code > 1) {
		throw new Error(`diff failed: ${result.stderr.trim()}`);
	}
	return result.stdout;
}

/** @returns One line's worth of words about `status`. */
function describe_status(status: Status): string {
	if (status.kind === "clean") {
		return "clean";
	}
	if (status.kind === "uncommitted") {
		return `up to date but not committed; commit ${AGENTS_MD} yourself`;
	}
	if (status.kind === "error") {
		return `error: ${status.message}`;
	}
	return status.dropped.length > 0 ? `dirty (drops: ${status.dropped.join(", ")})` : "dirty";
}

/**
 * @param dirs Repositories to inspect.
 * @param show_diff Whether to print each dirty repository's diff.
 * @returns The exit status: 0 only when every repository is clean.
 */
async function check(dirs: string[], show_diff: boolean): Promise<number> {
	let all_clean = true;
	for (const dir of dirs) {
		const status = await inspect(dir);
		console.log(`${tilde(dir)}: ${describe_status(status)}`);
		if (status.kind !== "clean") {
			all_clean = false;
		}
		if (status.kind === "dirty" && show_diff) {
			console.log(await unified_diff(dir, status.rendered));
		}
	}
	return all_clean ? 0 : 1;
}

/**
 * @param dirs Repositories to update.
 * @returns The exit status: 0 only when every repository is now clean.
 */
async function update_all(dirs: string[]): Promise<number> {
	const version = await describe(TOOL_DIR);
	const message = `${AGENTS_MD}: regenerate from clank-right template (${version})`;
	let failures = 0;
	for (const dir of dirs) {
		const status = await inspect(dir);
		if (status.kind !== "dirty") {
			console.log(`${tilde(dir)}: ${describe_status(status)}`);
			failures += status.kind === "clean" ? 0 : 1;
			continue;
		}
		try {
			const sha = await update(dir, status.rendered, message);
			const dropped = status.dropped.length > 0 ? ` (dropped: ${status.dropped.join(", ")})` : "";
			console.log(`${tilde(dir)}: committed ${sha}${dropped}`);
		} catch (error) {
			if (error instanceof ProjectError || error instanceof GitError) {
				console.log(`${tilde(dir)}: error: ${error.message}`);
				failures++;
				continue;
			}
			throw error;
		}
	}
	return failures === 0 ? 0 : 1;
}

/** @returns The process's exit status. */
async function main(argv: string[]): Promise<number> {
	try {
		const cli = parse_cli(argv);
		configureSync({
			sinks:   { console: getConsoleSink({ formatter: ansiColorFormatter }) },
			loggers: [
				{ category: ["clank-right"],     sinks: ["console"], lowestLevel: cli.verbose ? "debug" : "warning" },
				{ category: ["logtape", "meta"], sinks: ["console"], lowestLevel: "warning" },
			],
		});
		const dirs = await project_dirs(cli.dirs);
		return cli.command === "check"
			? await check(dirs, cli.diff)
			: await update_all(dirs);
	} catch (error) {
		if (error instanceof UsageError) {
			console.error(error.message);
			return 2;
		}
		throw error;
	}
}

process.exitCode = await main(process.argv.slice(2));
