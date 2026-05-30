import { shellInvocation } from '../core/commandAdapter.js';
import { runCommand } from '../core/process.js';
import { ok } from '../core/result.js';
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

async function runShellCommand(command: string, cwd: string, timeoutMs = 120000) {
  const invocation = shellInvocation(command);
  return runCommand(invocation.command, invocation.args, cwd, timeoutMs);
}
