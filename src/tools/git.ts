import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { runCommand } from '../core/process.js';
import { ok } from '../core/result.js';
import { truncateText } from '../core/text.js';
import { resolveInside } from '../core/paths.js';
import type { AppConfig } from '../config/schema.js';
import { redactSecretValuesEnabled, sanitizeResultsEnabled, workspaceChildEnvironmentMode } from '../core/securityPolicy.js';
import type { Workspace } from '../core/workspaces.js';

export async function gitStatus(config: AppConfig, workspace: Workspace) {
  const result = await runCommand('git', ['status', '--short', '--branch'], workspace.realRoot, 10000, {}, workspaceChildEnvironmentMode(config, workspace));
  return ok('git status', { exit_code: result.code, stdout: limit(result.stdout), stderr: limit(result.stderr) });
}

export async function gitDiff(config: AppConfig, workspace: Workspace, maxBytes = 20000) {
  const result = await runCommand('git', ['diff', '--', '.'], workspace.realRoot, 10000, {}, workspaceChildEnvironmentMode(config, workspace));
  const limited = truncateText(result.stdout, Math.min(maxBytes, 50000));
  return ok('git diff', { exit_code: result.code, stdout: limited.text, stderr: limit(result.stderr), truncated: limited.truncated });
}

export async function gitCliTool(config: AppConfig, workspace: Workspace, cmd: string[], cwdPath = '.', timeoutMs = 60000, maxOutputChars = 20000) {
  if (!workspace.allow_tests) throw new Error('workspace does not allow Git command execution');
  if (!Array.isArray(cmd) || cmd.length === 0) throw new Error('cmd_array must be an array');
  const cwd = await resolveInside(workspace, cwdPath, config);
  const timeout = Math.min(Math.max(1, timeoutMs), config.security.max_exec_ms);
  return withGitAuth(workspace, async (env, knownSecretValues) => {
    const executable = workspace.git?.git_cli || 'git';
    const environmentMode = workspaceChildEnvironmentMode(config, workspace);
    const sanitize = sanitizeResultsEnabled(config) || redactSecretValuesEnabled(config);
    const lfsInitialized = await initializeLfsForWorktreeAdd(executable, cmd, cwd.absolute, timeout, env, environmentMode, knownSecretValues);
    const result = await runCommand(executable, cmd.map(String), cwd.absolute, timeout, env, environmentMode);
    const output = truncateText(redactGitOutputForDisplay(`${result.stdout}${result.stderr}`, sanitize, knownSecretValues), Math.min(Math.max(1, maxOutputChars), 50000));
    return ok('git command finished', {
      command: ['git', ...cmd].map((value) => redactGitOutputForDisplay(value, sanitize, knownSecretValues)), cwd: cwd.displayPath,
      exit_code: result.code, timed_out: result.timed_out, output: output.text,
      truncated: output.truncated, auth_lane: 'configured_token_git_config_env', identity_lane: gitIdentityLane(workspace),
      lfs_initialized: lfsInitialized
    });
  });
}

export async function gitPushCurrentBranch(config: AppConfig, workspace: Workspace, repoPath = '.', remote = 'origin', branch?: string) {
  if (!workspace.allow_tests) throw new Error('workspace does not allow command execution');
  const context = await gitPublishContext(config, workspace, repoPath, remote, branch);
  return withGitAuth(workspace, async (env, knownSecretValues) => {
    if (await repositoryUsesGitLfs(context.executable, context.cwd, config.security.max_exec_ms, env, workspaceChildEnvironmentMode(config, workspace))) {
      return gitLfsPublish(config, workspace, context, env, knownSecretValues, undefined, true);
    }
    const result = await runCommand(context.executable, ['push', remote, context.branch], context.cwd, config.security.max_exec_ms, env, workspaceChildEnvironmentMode(config, workspace));
    return ok('git push finished', gitPushResult(workspace, context.cwd, remote, context.remoteUrl, context.branch, context.sha, result, sanitizeResultsEnabled(config) || redactSecretValuesEnabled(config), knownSecretValues));
  });
}

export async function gitLfsPublishCurrentBranch(config: AppConfig, workspace: Workspace, repoPath = '.', remote = 'origin', branch?: string, forceWithLeaseSha?: string) {
  if (!workspace.allow_tests) throw new Error('workspace does not allow command execution');
  if (forceWithLeaseSha && !/^[0-9a-f]{40}$/i.test(forceWithLeaseSha)) throw new Error('force_with_lease_sha must be a full 40-character Git SHA');
  const context = await gitPublishContext(config, workspace, repoPath, remote, branch);
  return withGitAuth(workspace, (env, knownSecretValues) => gitLfsPublish(config, workspace, context, env, knownSecretValues, forceWithLeaseSha, false));
}

async function gitLfsPublish(config: AppConfig, workspace: Workspace, context: Awaited<ReturnType<typeof gitPublishContext>>, env: Record<string, string>, knownSecretValues: string[], forceWithLeaseSha?: string, autoSelected = false) {
  const steps = [];
  for (const command of [['lfs', 'version'], ['lfs', 'install', '--local'], ['lfs', 'fsck', '--pointers', 'HEAD'], ['lfs', 'push', context.remote, context.branch]]) {
    const step = await runGitPublishStep(context.executable, command, context.cwd, config.security.max_exec_ms, env, workspaceChildEnvironmentMode(config, workspace), sanitizeResultsEnabled(config) || redactSecretValuesEnabled(config), knownSecretValues);
    steps.push(step);
    if (step.exit_code !== 0 || step.timed_out) return ok('git LFS publish failed', gitLfsPublishResult(workspace, context, steps, sanitizeResultsEnabled(config) || redactSecretValuesEnabled(config), forceWithLeaseSha, autoSelected));
  }
  const push = ['push', context.remote, context.branch];
  if (forceWithLeaseSha) push.splice(1, 0, `--force-with-lease=refs/heads/${context.branch}:${forceWithLeaseSha}`);
  steps.push(await runGitPublishStep(context.executable, push, context.cwd, config.security.max_exec_ms, env, workspaceChildEnvironmentMode(config, workspace), sanitizeResultsEnabled(config) || redactSecretValuesEnabled(config), knownSecretValues));
  return ok('git LFS publish finished', gitLfsPublishResult(workspace, context, steps, sanitizeResultsEnabled(config) || redactSecretValuesEnabled(config), forceWithLeaseSha, autoSelected));
}

async function initializeLfsForWorktreeAdd(executable: string, cmd: string[], cwd: string, timeout: number, env: Record<string, string>, environmentMode: 'full' | 'minimal', knownSecretValues: string[]): Promise<boolean> {
  if (cmd[0] !== 'worktree' || cmd[1] !== 'add') return false;
  if (!await repositoryUsesGitLfs(executable, cwd, timeout, env, environmentMode)) return false;
  const result = await runCommand(executable, ['lfs', 'install', '--local'], cwd, timeout, env, environmentMode);
  if (result.code !== 0 || result.timed_out) throw new Error(`git LFS initialization failed: ${safeGitMessage(result.stderr || result.stdout, false, knownSecretValues)}`);
  return true;
}

async function repositoryUsesGitLfs(executable: string, cwd: string, timeout: number, env: Record<string, string>, environmentMode: 'full' | 'minimal'): Promise<boolean> {
  const result = await runCommand(executable, ['grep', '-l', 'filter=lfs', 'HEAD', '--', '.gitattributes', ':(glob)**/.gitattributes'], cwd, timeout, env, environmentMode);
  return result.code === 0 && Boolean(result.stdout.trim());
}

async function withGitAuth<T>(workspace: Workspace, action: (env: Record<string, string>, knownSecretValues: string[]) => Promise<T>): Promise<T> {
  const tokenFile = workspace.git?.github_token_file || defaultTokenPath(workspace);
  const token = await readGitToken(tokenFile);
  const env = { ...gitAuthEnvironment(token), ...gitIdentityEnvironment(workspace) };
  return action(env, gitAuthSecretValues(env, token));
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

function gitPushResult(workspace: Workspace, cwd: string, remote: string, remoteUrlRaw: string, branch: string, sha: string, result: { code: number | null; stdout: string; stderr: string; timed_out: boolean }, sanitize: boolean, knownSecretValues: string[] = []) {
  const output = truncateText(redactGitOutputForDisplay(result.stdout + result.stderr, sanitize, knownSecretValues), 50000);
  const failed = result.code !== 0 || result.timed_out;
  return {
    status: failed ? 'failed' : 'pushed',
    failure_class: failed ? classifyGitPushFailure(output.text, result.timed_out) : null,
    repo_path: path.relative(workspace.realRoot, cwd) || '.',
    remote,
    remote_url: sanitizeGitRemoteForDisplay(remoteUrlRaw, sanitize, knownSecretValues),
    branch,
    sha,
    publish_mode: 'git',
    exit_code: result.code,
    timed_out: result.timed_out,
    output: output.text,
    truncated: output.truncated
  };
}

async function gitPublishContext(config: AppConfig, workspace: Workspace, repoPath: string, remote: string, branch?: string) {
  const repo = await resolveInside(workspace, repoPath, config);
  const executable = workspace.git?.git_cli || 'git';
  const isRepo = await runCommand(executable, ['rev-parse', '--is-inside-work-tree'], repo.absolute, config.security.max_exec_ms, {}, workspaceChildEnvironmentMode(config, workspace));
  if (isRepo.code !== 0 || !isRepo.stdout.includes('true')) throw new Error('git repo diagnostic: repo_path is not inside a git work tree');
  const cwd = await gitOutput(executable, ['rev-parse', '--show-toplevel'], repo.absolute, config, workspace, 'git repo diagnostic: failed to resolve git root');
  const currentBranch = branch || await gitOutput(executable, ['rev-parse', '--abbrev-ref', 'HEAD'], cwd, config, workspace, 'git ref diagnostic: failed to resolve current branch');
  if (!currentBranch || currentBranch === 'HEAD') throw new Error('cannot push detached HEAD without an explicit branch');
  const sha = await gitOutput(executable, ['rev-parse', 'HEAD'], cwd, config, workspace, 'git ref diagnostic: failed to resolve HEAD');
  const remoteUrl = await gitOutput(executable, ['remote', 'get-url', remote], cwd, config, workspace, `git remote diagnostic: remote not found or unreadable: ${remote}`);
  return { executable, cwd, branch: currentBranch, sha, remote, remoteUrl };
}

async function runGitPublishStep(executable: string, args: string[], cwd: string, timeout: number, env: Record<string, string>, environmentMode: 'full' | 'minimal', sanitize: boolean, knownSecretValues: string[]) {
  const result = await runCommand(executable, args, cwd, timeout, env, environmentMode);
  const output = truncateText(redactGitOutputForDisplay(result.stdout + result.stderr, sanitize, knownSecretValues), 50000);
  return { command: ['git', ...args], exit_code: result.code, timed_out: result.timed_out, output: output.text, truncated: output.truncated };
}

function gitLfsPublishResult(workspace: Workspace, context: Awaited<ReturnType<typeof gitPublishContext>>, steps: Awaited<ReturnType<typeof runGitPublishStep>>[], sanitize: boolean, forceWithLeaseSha?: string, autoSelected = false) {
  const failed = steps.find((step) => step.exit_code !== 0 || step.timed_out);
  return {
    status: failed ? 'failed' : 'pushed', failed_command: failed?.command ?? null,
    repo_path: path.relative(workspace.realRoot, context.cwd) || '.', remote: context.remote,
    remote_url: sanitizeGitRemoteForDisplay(context.remoteUrl, sanitize), branch: context.branch, sha: context.sha,
    force_with_lease_sha: forceWithLeaseSha ?? null, publish_mode: 'git_lfs', auto_selected: autoSelected,
    steps, auth_lane: 'configured_token_git_config_env'
  };
}

async function gitOutput(executable: string, args: string[], cwd: string, config: AppConfig, workspace: Workspace, context: string): Promise<string> {
  const result = await runCommand(executable, args, cwd, config.security.max_exec_ms, {}, workspaceChildEnvironmentMode(config, workspace));
  if (result.code !== 0) throw new Error(`${context}: ${safeGitMessage(result.stderr || result.stdout || `git ${args.join(' ')} failed`, sanitizeResultsEnabled(config) || redactSecretValuesEnabled(config))}`);
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

export function sanitizeGitRemoteForDisplay(url: string, enabled = false, knownSecretValues: string[] = []): string {
  const exact = redactKnownSecretValues(url, knownSecretValues);
  return enabled ? exact.replace(/(https?:\/\/)([^/@:]+)(:[^/@]+)?@/g, '$1') : exact;
}

export function redactGitOutputForDisplay(text: string, enabled = false, knownSecretValues: string[] = []): string {
  const exact = redactKnownSecretValues(text, knownSecretValues);
  if (!enabled) return exact;
  return exact.replace(/github_pat_[A-Za-z0-9_]+/g, '[GITHUB_TOKEN_REDACTED]')
    .replace(/gh[pousr]_[A-Za-z0-9_]+/g, '[GITHUB_TOKEN_REDACTED]')
    .replace(/(https?:\/\/)([^\s/@:]+)(:[^\s/@]+)?@/g, '$1');
}

function redactKnownSecretValues(text: string, knownSecretValues: string[]): string {
  let redacted = text;
  for (const value of [...new Set(knownSecretValues.filter(Boolean))].sort((left, right) => right.length - left.length)) {
    redacted = redacted.replaceAll(value, '[GITHUB_TOKEN_REDACTED]');
  }
  return redacted;
}

function gitAuthSecretValues(env: Record<string, string>, token?: string): string[] {
  const header = env.GIT_CONFIG_VALUE_0;
  const encoded = header ? /^Authorization:\s+Basic\s+(.+)$/i.exec(header)?.[1] : undefined;
  return [token, header, encoded].filter((value): value is string => Boolean(value));
}
function classifyGitPushFailure(output: string, timedOut: boolean): string {
  if (timedOut) return 'timeout';
  if (/src refspec|does not match any/i.test(output)) return 'ref_mismatch';
  if (/Authentication failed|could not read Username|Permission denied|Repository not found/i.test(output)) return 'auth_or_repo';
  if (/not appear to be a git repository|Could not read from remote repository|unable to access/i.test(output)) return 'remote_unreachable';
  return 'git_push_failed';
}

function safeGitMessage(text: string, sanitize = false, knownSecretValues: string[] = []): string {
  return limit(redactGitOutputForDisplay(text || 'unknown git failure', sanitize, knownSecretValues));
}

function limit(text: string, max = 20000): string {
  return text.length > max ? text.slice(0, max) : text;
}
