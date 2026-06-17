import { mkdtemp, readFile, rm, writeFile, chmod } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runCommand } from '../core/process.js';
import { ok } from '../core/result.js';
import { truncateText } from '../core/text.js';
import { resolveInside } from '../core/paths.js';
import type { AppConfig } from '../config/schema.js';
import type { Workspace } from '../core/workspaces.js';

export async function gitStatus(workspace: Workspace) {
  const result = await runCommand('git', ['status', '--short', '--branch'], workspace.realRoot);
  return ok('git status', { exit_code: result.code, stdout: limit(result.stdout), stderr: limit(result.stderr) });
}

export async function gitDiff(workspace: Workspace, maxBytes = 20000) {
  const result = await runCommand('git', ['diff', '--', '.'], workspace.realRoot);
  const limited = truncateText(result.stdout, Math.min(maxBytes, 50000));
  return ok('git diff', { exit_code: result.code, stdout: limited.text, stderr: limit(result.stderr), truncated: limited.truncated });
}

export async function gitPushCurrentBranch(config: AppConfig, workspace: Workspace, repoPath = '.', remote = 'origin', branch?: string) {
  if (!workspace.allow_tests) throw new Error('workspace does not allow command execution');
  const repo = await resolveInside(workspace, repoPath, config);
  const isRepo = await runCommand('git', ['rev-parse', '--is-inside-work-tree'], repo.absolute, config.security.max_exec_ms);
  if (isRepo.code !== 0 || !isRepo.stdout.includes('true')) throw new Error('path is not inside a git work tree');
  const top = await runCommand('git', ['rev-parse', '--show-toplevel'], repo.absolute, config.security.max_exec_ms);
  if (top.code !== 0) throw new Error(limit(top.stderr || 'failed to resolve git root'));
  const cwd = top.stdout.trim();
  const currentBranch = branch || (await gitOutput(['rev-parse', '--abbrev-ref', 'HEAD'], cwd, config));
  if (!currentBranch || currentBranch === 'HEAD') throw new Error('cannot push detached HEAD without an explicit branch');
  const sha = await gitOutput(['rev-parse', '--short', 'HEAD'], cwd, config);
  const remoteUrlRaw = await gitOutput(['remote', 'get-url', remote], cwd, config);
  const tokenFile = workspace.git?.github_token_file || defaultTokenPath(workspace);
  const askpassDir = await mkdtemp(path.join(os.tmpdir(), 'ota-git-askpass-'));
  const askpass = path.join(askpassDir, 'askpass.sh');
  try {
    await assertReadableToken(tokenFile);
    await writeFile(askpass, askpassScript(tokenFile), { mode: 0o700 });
    await chmod(askpass, 0o700);
    const result = await runCommand('git', ['push', remote, currentBranch], cwd, config.security.max_exec_ms, {
      GIT_ASKPASS: askpass,
      GIT_TERMINAL_PROMPT: '0'
    });
    const output = truncateText(redactGitOutputForDisplay(result.stdout + result.stderr), 50000);
    return ok('git push finished', {
      repo_path: path.relative(workspace.realRoot, cwd) || '.',
      remote,
      remote_url: sanitizeGitRemoteForDisplay(remoteUrlRaw),
      branch: currentBranch,
      sha,
      exit_code: result.code,
      output: output.text,
      truncated: output.truncated
    });
  } finally {
    await rm(askpassDir, { recursive: true, force: true });
  }
}

async function gitOutput(args: string[], cwd: string, config: AppConfig): Promise<string> {
  const result = await runCommand('git', args, cwd, config.security.max_exec_ms);
  if (result.code !== 0) throw new Error(limit(result.stderr || result.stdout || `git ${args.join(' ')} failed`));
  return result.stdout.trim();
}

async function assertReadableToken(tokenFile: string) {
  const token = (await readFile(tokenFile, 'utf8')).trim();
  if (!token) throw new Error('configured git token file is empty');
}

function defaultTokenPath(workspace: Workspace): string {
  return path.join(workspace.realRoot, 'secrets', `${workspace.id}_github_pat.txt`);
}

function askpassScript(tokenFile: string): string {
  const safePath = tokenFile.replace(/'/g, `'"'"'`);
  return `#!/usr/bin/env bash\ncase "$1" in\n  *Username*) printf '%s\\n' 'x-access-token' ;;\n  *Password*) cat '${safePath}' ;;\n  *) printf '\\n' ;;\nesac\n`;
}

export function sanitizeGitRemoteForDisplay(url: string): string {
  return url.replace(/(https?:\/\/)([^/@:]+)(:[^/@]+)?@/g, '$1');
}

export function redactGitOutputForDisplay(text: string): string {
  return text.replace(/gh[pousr]_[A-Za-z0-9_]+/g, '[GITHUB_TOKEN_REDACTED]')
    .replace(/(https?:\/\/)([^\s/@:]+)(:[^\s/@]+)?@/g, '$1');
}

function limit(text: string, max = 20000): string {
  return text.length > max ? text.slice(0, max) : text;
}
