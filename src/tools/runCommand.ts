import { requireApproval } from './approval.js';
import { runCommand } from '../core/process.js';
import { ok } from '../core/result.js';
import { truncateText } from '../core/text.js';
import type { Workspace } from '../core/workspaces.js';

const MAX_OUTPUT_BYTES = 50000;

export async function runConfiguredCommand(workspace: Workspace, commandId: string, approvalAction = `run_command:${commandId}`) {
  if (!workspace.allow_tests) throw new Error('workspace does not allow command execution');
  await requireApproval(workspace, approvalAction);
  const command = workspace.commands[commandId];
  if (!command) throw new Error(`unknown command id: ${commandId}`);
  const result = await runShellCommand(command, workspace.realRoot);
  const output = truncateText(result.stdout + result.stderr, MAX_OUTPUT_BYTES);
  return ok('configured command finished', { command_id: commandId, exit_code: result.code, output: output.text, truncated: output.truncated });
}

async function runShellCommand(command: string, cwd: string) {
  return runCommand('/bin/sh', ['-lc', command], cwd, 120000);
}
