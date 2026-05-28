import { runCommand } from '../core/process.js';
import { ok } from '../core/result.js';
import type { Workspace } from '../core/workspaces.js';

export async function gitStatus(workspace: Workspace) {
  const result = await runCommand('git', ['status', '--short', '--branch'], workspace.realRoot);
  return ok('git status', { exit_code: result.code, stdout: limit(result.stdout), stderr: limit(result.stderr) });
}

export async function gitDiff(workspace: Workspace, maxBytes = 20000) {
  const result = await runCommand('git', ['diff', '--', '.'], workspace.realRoot);
  const stdout = limit(result.stdout, Math.min(maxBytes, 50000));
  return ok('git diff', { exit_code: result.code, stdout, stderr: limit(result.stderr), truncated: result.stdout.length > stdout.length });
}

function limit(text: string, max = 20000): string {
  return text.length > max ? text.slice(0, max) : text;
}
