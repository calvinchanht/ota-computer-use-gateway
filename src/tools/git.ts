import { readFile } from 'node:fs/promises';
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

export async function gitCliTool(config: AppConfig, workspace: Workspace, cmd: string[], cwdPath = '.', timeoutMs = 60000, maxOutputChars = 20000) {
  if (!workspace.allow_tests) throw new Error('workspace does not allow Git command execution');
  if (!Array.isArray(cmd) || cmd.length === 0) throw new Error('cmd_array must be an array');
  const cwd = await resolveInside(workspace, cwdPath, config);
  const timeout = Math.min(Math.max(1, timeoutMs), config.security.max_exec_ms);
  return withGitAuth(workspace, async (env) => {
    const result = await runCommand(workspace.git?.git_cli || 'git', cmd.map(String), cwd.absolute, timeout, env);
    const output = truncateText(redactGitOutputForDisplay(`${result.stdout}${result.stderr}`), Math.min(Math.max(1, maxOutputChars), 50000));
    return ok('git command finished', {
      command: ['git', ...cmd].map(redactGitOutputForDisplay), cwd: cwd.displayPath,
      exit_code: result.code, timed_out: result.timed_out, output: output.text,
      truncated: output.truncated, auth_lane: 'configured_token_git_config_env', identity_lane: gitIdentityLane(workspace)
    });
  });
}

export async function gitPushCurrentBranch(config: AppConfig, workspace: Workspace, repoPath = '.', remote = 'origin', branch?: string) {
  if (!workspace.allow_tests) throw new Error('workspace does not allow command execution');
  const context = await gitPublishContext(config, workspace, repoPath, remote, branch);
  return withGitAuth(workspace, async (env) => {
    const result = await runCommand(context.executable, ['push', remote, context.branch], context.cwd, config.security.max_exec_ms, env);
    return ok('git push finished', gitPushResult(workspace, context.cwd, remote, context.remoteUrl, context.branch, context.sha, result));
  });
}

export async function gitLfsPublishCurrentBranch(config: AppConfig, workspace: Workspace, repoPath = '.', remote = 'origin', branch?: string, forceWithLeaseSha?: string) {
  if (!workspace.allow_tests) throw new Error('workspace does not allow command execution');
  if (forceWithLeaseSha && !/^[0-9a-f]{40}$/i.test(forceWithLeaseSha)) throw new Error('force_with_lease_sha must be a full 40-character Git SHA');
  const context = await gitPublishContext(config, workspace, repoPath, remote, branch);
  return withGitAuth(workspace, async (env) => {
    const steps = [];
    for (const command of [['lfs', 'version'], ['lfs', 'fsck', '--pointers', 'HEAD'], ['lfs', 'push', remote, context.branch]]) {
      const step = await runGitPublishStep(context.executable, command, context.cwd, config.security.max_exec_ms, env);
      steps.push(step);
      if (step.exit_code !== 0 || step.timed_out) return ok('git LFS publish failed', gitLfsPublishResult(workspace, context, steps, forceWithLeaseSha));
    }
    const push = ['push', remote, context.branch];
    if (forceWithLeaseSha) push.splice(1, 0, `--force-with-lease=refs/heads/${context.branch}:${forceWithLeaseSha}`);
    steps.push(await runGitPublishStep(context.executable, push, context.cwd, config.security.max_exec_ms, env));
    return ok('git LFS publish finished', gitLfsPublishResult(workspace, context, steps, forceWithLeaseSha));
  });
}

async function withGitAuth<T>(workspace: Workspace, action: (env: Record<string, string>) => Promise<T>): Promise<T> {
  const tokenFile = workspace.git?.github_token_file || defaultTokenPath(workspace);
  const token = await readGitToken(tokenFile);
  return action({ ...gitAuthEnvironment(token), ...gitIdentityEnvironment(workspace) });
}

function gitAuthEnvironment(token: string): Record<string, string> {
  const authorization = Buffer.from(`x-access-token:${token}`).toString('base64');
  return {
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
    GIT_CONFIG_VALUE_0: `Authorization: Basic ${authorization}`,
    GIT_TERMINAL_PROMPT: '0'
  };
}

function gitIdentityEnvironment(workspace: Workspace): Record<string, string> {
  const name = workspace.git?.user_name;
  const email = workspace.git?.user_email;
  if (!name || !email) return {};
  return { GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email, GIT_COMMITTER_NAME: name, GIT_COMMITTER_EMAIL: email };
}

function gitIdentityLane(workspace: Workspace): string {
  return workspace.git?.user_name && workspace.git?.user_email ? 'configured_workspace_identity' : 'repository_or_global_identity';
}

function gitPushResult(workspace: Workspace, cwd: string, remote: string, remoteUrlRaw: string, branch: string, sha: string, result: { code: number | null; stdout: string; stderr: string; timed_out: boolean }) {
  const output = truncateText(redactGitOutputForDisplay(result.stdout + result.stderr), 50000);
  const failed = result.code !== 0 || result.timed_out;
  return {
    status: failed ? 'failed' : 'pushed',
    failure_class: failed ? classifyGitPushFailure(output.text, result.timed_out) : null,
    repo_path: path.relative(workspace.realRoot, cwd) || '.',
    remote,
    remote_url: sanitizeGitRemoteForDisplay(remoteUrlRaw),
    branch,
    sha,
    exit_code: result.code,
    timed_out: result.timed_out,
    output: output.text,
    truncated: output.truncated
  };
}

async function gitPublishContext(config: AppConfig, workspace: Workspace, repoPath: string, remote: string, branch?: string) {
  const repo = await resolveInside(workspace, repoPath, config);
  const executable = workspace.git?.git_cli || 'git';
  const isRepo = await runCommand(executable, ['rev-parse', '--is-inside-work-tree'], repo.absolute, config.security.max_exec_ms);
  if (isRepo.code !== 0 || !isRepo.stdout.includes('true')) throw new Error('git repo diagnostic: repo_path is not inside a git work tree');
  const cwd = await gitOutput(executable, ['rev-parse', '--show-toplevel'], repo.absolute, config, 'git repo diagnostic: failed to resolve git root');
  const currentBranch = branch || await gitOutput(executable, ['rev-parse', '--abbrev-ref', 'HEAD'], cwd, config, 'git ref diagnostic: failed to resolve current branch');
  if (!currentBranch || currentBranch === 'HEAD') throw new Error('cannot push detached HEAD without an explicit branch');
  const sha = await gitOutput(executable, ['rev-parse', 'HEAD'], cwd, config, 'git ref diagnostic: failed to resolve HEAD');
  const remoteUrl = await gitOutput(executable, ['remote', 'get-url', remote], cwd, config, `git remote diagnostic: remote not found or unreadable: ${remote}`);
  return { executable, cwd, branch: currentBranch, sha, remote, remoteUrl };
}

async function runGitPublishStep(executable: string, args: string[], cwd: string, timeout: number, env: Record<string, string>) {
  const result = await runCommand(executable, args, cwd, timeout, env);
  const output = truncateText(redactGitOutputForDisplay(result.stdout + result.stderr), 50000);
  return { command: ['git', ...args], exit_code: result.code, timed_out: result.timed_out, output: output.text, truncated: output.truncated };
}

function gitLfsPublishResult(workspace: Workspace, context: Awaited<ReturnType<typeof gitPublishContext>>, steps: Awaited<ReturnType<typeof runGitPublishStep>>[], forceWithLeaseSha?: string) {
  const failed = steps.find((step) => step.exit_code !== 0 || step.timed_out);
  return {
    status: failed ? 'failed' : 'pushed', failed_command: failed?.command ?? null,
    repo_path: path.relative(workspace.realRoot, context.cwd) || '.', remote: context.remote,
    remote_url: sanitizeGitRemoteForDisplay(context.remoteUrl), branch: context.branch, sha: context.sha,
    force_with_lease_sha: forceWithLeaseSha ?? null, steps, auth_lane: 'configured_token_git_config_env'
  };
}

async function gitOutput(executable: string, args: string[], cwd: string, config: AppConfig, context: string): Promise<string> {
  const result = await runCommand(executable, args, cwd, config.security.max_exec_ms);
  if (result.code !== 0) throw new Error(`${context}: ${safeGitMessage(result.stderr || result.stdout || `git ${args.join(' ')} failed`)}`);
  return result.stdout.trim();
}

async function readGitToken(tokenFile: string): Promise<string> {
  let token = '';
  try {
    token = (await readFile(tokenFile, 'utf8')).trim();
  } catch {
    throw new Error('git auth diagnostic: configured github token file is not readable');
  }
  if (!token) throw new Error('git auth diagnostic: configured github token file is empty');
  return token;
}

function defaultTokenPath(workspace: Workspace): string {
  return path.join(workspace.realRoot, 'secrets', `${workspace.id}_github_pat.txt`);
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
