import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { gitPushCurrentBranch, redactGitOutputForDisplay, sanitizeGitRemoteForDisplay } from '../src/tools/git.js';
import type { AppConfig } from '../src/config/schema.js';
import type { Workspace } from '../src/core/workspaces.js';

const config: AppConfig = {
  server: { host: '127.0.0.1', port: 8765 },
  workspaces: [],
  security: { max_file_bytes: 1000, max_response_bytes: 1000, max_request_bytes: 1000, max_search_results: 10, max_exec_ms: 120000, denied_globs: [] }
};

describe('git display hygiene', () => {
  it('removes credentials from remote URLs', () => {
    expect(sanitizeGitRemoteForDisplay('https://user:secret@github.com/owner/repo.git'))
      .toBe('https://github.com/owner/repo.git');
  });

  it('redacts GitHub token material from command output', () => {
    const output = 'token ghp_abc123TOKEN remote https://x-access-token:secret@github.com/owner/repo.git';
    expect(redactGitOutputForDisplay(output)).not.toContain('ghp_abc123TOKEN');
    expect(redactGitOutputForDisplay(output)).not.toContain('secret@');
    expect(redactGitOutputForDisplay(output)).toContain('[GITHUB_TOKEN_REDACTED]');
    expect(redactGitOutputForDisplay(output)).toContain('https://github.com/owner/repo.git');
  });

  it('identifies non-repo push targets', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'gtp-git-nonrepo-'));
    await expect(gitPushCurrentBranch(config, workspace(root), '.'))
      .rejects.toThrow('git repo diagnostic');
  });

  it('identifies missing remotes before auth setup', async () => {
    const repo = await fixtureRepo();
    await expect(gitPushCurrentBranch(config, workspace(repo.root, repo.tokenFile), '.'))
      .rejects.toThrow('git remote diagnostic');
  });

  it('identifies unreadable token files without exposing token paths', async () => {
    const repo = await fixtureRepo();
    runGit(repo.root, ['remote', 'add', 'origin', 'https://github.com/example/repo.git']);
    await expect(gitPushCurrentBranch(config, workspace(repo.root, path.join(repo.root, 'missing-token.txt')), '.'))
      .rejects.toThrow('git auth diagnostic');
  });

  it('classifies ref mismatch push failures', async () => {
    const repo = await fixtureRepo();
    const remote = await mkdtemp(path.join(tmpdir(), 'gtp-git-remote-'));
    runGit(remote, ['init', '--bare']);
    runGit(repo.root, ['remote', 'add', 'origin', remote]);
    const result = await gitPushCurrentBranch(config, workspace(repo.root, repo.tokenFile), '.', 'origin', 'missing-branch');
    expect(result.data).toMatchObject({ status: 'failed', failure_class: 'ref_mismatch' });
  });
});

async function fixtureRepo() {
  const root = await mkdtemp(path.join(tmpdir(), 'gtp-git-repo-'));
  runGit(root, ['init']);
  runGit(root, ['config', 'user.email', 'test@example.com']);
  runGit(root, ['config', 'user.name', 'Test User']);
  await writeFile(path.join(root, 'README.md'), 'hello\n');
  runGit(root, ['add', 'README.md']);
  runGit(root, ['commit', '-m', 'init']);
  const tokenDir = path.join(root, 'secrets');
  await mkdir(tokenDir);
  const tokenFile = path.join(tokenDir, 'test_github_pat.txt');
  await writeFile(tokenFile, 'dummy-token\n');
  return { root, tokenFile };
}

function workspace(root: string, tokenFile?: string): Workspace {
  return {
    id: 'test',
    name: 'Test',
    root,
    realRoot: root,
    allow_read: true,
    allow_write: false,
    allow_patch: false,
    allow_tests: true,
    allow_screen: false,
    allow_mouse_keyboard: false,
    browser: { profiles: [] },
    commands: {},
    git: tokenFile ? { github_token_file: tokenFile } : {}
  };
}

function runGit(cwd: string, args: string[]): void {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `git ${args.join(' ')} failed`);
}
