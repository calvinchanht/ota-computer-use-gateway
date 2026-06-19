import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { runCommand } from '../core/process.js';
import { resolveInside } from '../core/paths.js';
import { ok } from '../core/result.js';
import { truncateText } from '../core/text.js';
import { redactGitOutputForDisplay } from './git.js';
import type { AppConfig } from '../config/schema.js';
import type { Workspace } from '../core/workspaces.js';

export async function githubCliTool(config: AppConfig, workspace: Workspace, cmd: string[], cwdPath = '.', timeoutMs = 60000, maxOutputChars = 20000) {
  if (!workspace.allow_tests) throw new Error('workspace does not allow GitHub command execution');
  if (!Array.isArray(cmd) || cmd.length === 0) throw new Error('cmd_array must be an array');
  const token = await githubToken(workspace);
  const cwd = await resolveInside(workspace, cwdPath, config);
  const timeout = Math.min(Math.max(1, timeoutMs), config.security.max_exec_ms);
  const result = await runCommand(githubExecutable(workspace), cmd.map(String), cwd.absolute, timeout, {
    GH_TOKEN: token,
    GITHUB_TOKEN: token
  });
  const output = redactGithubOutput(`${result.stdout}${result.stderr}`, token);
  const limited = truncateText(output, Math.min(Math.max(1, maxOutputChars), 50000));
  return ok('github command finished', {
    command: ['gh', ...cmd],
    cwd: cwd.displayPath,
    exit_code: result.code,
    timed_out: result.timed_out,
    output: limited.text,
    truncated: limited.truncated,
    auth_lane: workspace.git?.github_cli_wrapper ? 'configured_wrapper' : 'configured_token_env'
  });
}

async function githubToken(workspace: Workspace): Promise<string> {
  const tokenFile = workspace.git?.github_token_file || defaultTokenPath(workspace);
  try {
    const token = (await readFile(tokenFile, 'utf8')).trim();
    if (token) return token;
  } catch {
    throw new Error('github auth diagnostic: configured github token file is not readable');
  }
  throw new Error('github auth diagnostic: configured github token file is empty');
}

function githubExecutable(workspace: Workspace): string {
  return workspace.git?.github_cli_wrapper || workspace.git?.github_cli || 'gh';
}

function defaultTokenPath(workspace: Workspace): string {
  return path.join(workspace.realRoot, 'secrets', `${workspace.id}_github_pat.txt`);
}

function redactGithubOutput(text: string, token: string): string {
  return redactGitOutputForDisplay(text).replaceAll(token, '[GITHUB_TOKEN_REDACTED]');
}
