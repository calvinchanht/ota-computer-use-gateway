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
  if (isRepo.code !== 0 || !isRepo.stdout.includes('true')) throw new Error('git repo diagnostic: repo_path is not inside a git work tree');
  const top = await runCommand('git', ['rev-parse', '--show-toplevel'], repo.absolute, config.security.max_exec_ms);
  if (top.code !== 0) throw new Error(`git repo diagnostic: failed to resolve git root: ${safeGitMessage(top.stderr || top.stdout)}`);
  const cwd = top.stdout.trim();
  const currentBranch = branch || (await gitOutput(['rev-parse', '--abbrev-ref', 'HEAD'], cwd, config, 'git ref diagnostic: failed to resolve current branch'));
  if (!currentBranch || currentBranch === 'HEAD') throw new Error('cannot push detached HEAD without an explicit branch');
  const sha = await gitOutput(['rev-parse', '--short', 'HEAD'], cwd, config, 'git ref diagnostic: failed to resolve HEAD');
  const remoteUrlRaw = await gitOutput(['remote', 'get-url', remote], cwd, config, `git remote diagnostic: remote not found or unreadable: ${remote}`);
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
    const failed = result.code !== 0 || result.timed_out;
    return ok('git push finished', {
      status: failed ? 'failed' : 'pushed',
      failure_class: failed ? classifyGitPushFailure(output.text, result.timed_out) : null,
      repo_path: path.relative(workspace.realRoot, cwd) || '.',
      remote,
      remote_url: sanitizeGitRemoteForDisplay(remoteUrlRaw),
      branch: currentBranch,
      sha,
      exit_code: result.code,
      timed_out: result.timed_out,
      output: output.text,
      truncated: output.truncated
    });
  } finally {
    await rm(askpassDir, { recursive: true, force: true });
  }
}

async function gitOutput(args: string[], cwd: string, config: AppConfig, context: string): Promise<string> {
  const result = await runCommand('git', args, cwd, config.security.max_exec_ms);
  if (result.code !== 0) throw new Error(`${context}: ${safeGitMessage(result.stderr || result.stdout || `git ${args.join(' ')} failed`)}`);
  return result.stdout.trim();
}

async function assertReadableToken(tokenFile: string) {
  let token = '';
  try {
    token = (await readFile(tokenFile, 'utf8')).trim();
  } catch {
    throw new Error('git auth diagnostic: configured github token file is not readable');
  }
  if (!token) throw new Error('git auth diagnostic: configured github token file is empty');
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
  return text.replace(/github_pat_[A-Za-z0-9_]+/g, '[GITHUB_TOKEN_REDACTED]')
    .replace(/gh[pousr]_[A-Za-z0-9_]+/g, '[GITHUB_TOKEN_REDACTED]')
    .replace(/(https?:\/\/)([^\s/@:]+)(:[^\s/@]+)?@/g, '$1');
}

function classifyGitPushFailure(output: string, timedOut: boolean): string {
  if (timedOut) return 'timeout';
  if (/src refspec|does not match any/i.test(output)) return 'ref_mismatch';
  if (/Authentication failed|could not read Username|Permission denied|Repository not found/i.test(output)) return 'auth_or_repo';
  if (/not appear to be a git repository|Could not read from remote repository|unable to access/i.test(output)) return 'remote_unreachable';
  return 'git_push_failed';
}

function safeGitMessage(text: string): string {
  return limit(redactGitOutputForDisplay(text || 'unknown git failure'));
}

function limit(text: string, max = 20000): string {
  return text.length > max ? text.slice(0, max) : text;
}
