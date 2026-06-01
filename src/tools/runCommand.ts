import { shellInvocation } from '../core/commandAdapter.js';
import { runCommand } from '../core/process.js';
import { ok } from '../core/result.js';
import { resolveInside } from '../core/paths.js';
import { truncateText } from '../core/text.js';
import type { AppConfig } from '../config/schema.js';
import type { Workspace } from '../core/workspaces.js';

const MAX_OUTPUT_BYTES = 50000;

export async function runConfiguredCommand(workspace: Workspace, commandId: string) {
  if (!workspace.allow_tests) throw new Error('workspace does not allow command execution');
  const command = workspace.commands[commandId];
  if (!command) throw new Error(`unknown command id: ${commandId}`);
  const result = await runShellCommand(command, workspace.realRoot);
  const output = truncateText(result.stdout + result.stderr, MAX_OUTPUT_BYTES);
  return ok('configured command finished', { command_id: commandId, exit_code: result.code, output: output.text, truncated: output.truncated });
}

export async function runShellTool(config: AppConfig, workspace: Workspace, command: string) {
  if (!workspace.allow_tests) throw new Error('workspace does not allow command execution');
  const result = await runShellCommand(command, workspace.realRoot, config.security.max_exec_ms);
  const output = truncateText(result.stdout + result.stderr, MAX_OUTPUT_BYTES);
  return ok('command finished', { exit_code: result.code, output: output.text, truncated: output.truncated });
}

export async function runArgvTool(config: AppConfig, workspace: Workspace, cmd: string[], cwdPath = '.', timeoutMs = 30000, maxStdoutBytes = 20000, maxStderrBytes = 8000) {
  if (!workspace.allow_tests) throw new Error('workspace does not allow command execution');
  if (!Array.isArray(cmd) || cmd.length === 0) throw new Error('cmd array is required');
  const [command, ...args] = cmd.map(String);
  const cwd = await resolveInside(workspace, cwdPath, config);
  const timeout = Math.min(Math.max(1, timeoutMs), config.security.max_exec_ms);
  const result = await runCommand(command, args, cwd.absolute, timeout);
  const stdout = truncateText(result.stdout, Math.min(Math.max(1, maxStdoutBytes), MAX_OUTPUT_BYTES));
  const stderr = truncateText(result.stderr, Math.min(Math.max(1, maxStderrBytes), MAX_OUTPUT_BYTES));
  return ok('command finished', { command: cmd, cwd: cwd.relative, timeout_ms: timeout, exit_code: result.code, stdout: stdout.text, stderr: stderr.text, stdout_truncated: stdout.truncated, stderr_truncated: stderr.truncated });
}

async function runShellCommand(command: string, cwd: string, timeoutMs = 120000) {
  const invocation = shellInvocation(command);
  return runCommand(invocation.command, invocation.args, cwd, timeoutMs);
}
