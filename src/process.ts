// Model-output: Claude Fable 5.1
//
// Runs a child process to completion.

import { spawn } from "node:child_process";

export interface ProcessResult {
	/** The exit status, or -1 when the process died from a signal. */
	code: number;
	stdout: string;
	stderr: string;
}

/**
 * @param command The executable, found through PATH.
 * @param args Its arguments.
 * @param input Text to feed on stdin; stdin is closed either way.
 * @returns The exit status and captured output once the process has exited.
 */
export function run_process(command: string, args: string[], input = ""): Promise<ProcessResult> {
	return new Promise<ProcessResult>((resolve, reject) => {
		const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
		const stdout: Buffer[] = [];
		const stderr: Buffer[] = [];
		child.stdout.on("data", (chunk: Buffer) => {
			stdout.push(chunk);
		});
		child.stderr.on("data", (chunk: Buffer) => {
			stderr.push(chunk);
		});
		child.on("error", reject);
		child.on("close", (code) => {
			resolve({
				code:   code ?? -1,
				stdout: Buffer.concat(stdout).toString(),
				stderr: Buffer.concat(stderr).toString(),
			});
		});
		// A process that exits without reading stdin makes our write fail with
		// EPIPE; its exit status is what matters, so that failure is ignored.
		child.stdin.on("error", () => {});
		child.stdin.end(input);
	});
}
