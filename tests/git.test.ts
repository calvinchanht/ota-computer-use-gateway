import { createServer, type Server } from 'node:http';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { gitCliTool, gitLfsPublishCurrentBranch, gitPushCurrentBranch, redactGitOutputForDisplay, sanitizeGitRemoteForDisplay } from '../src/tools/git.js';
import { githubCliTool } from '../src/tools/github.js';
import { createHttpRequestHandler } from '../src/server/http.js';
import type { AppConfig } from '../src/config/schema.js';
import type { Workspace } from '../src/core/workspaces.js';

const config: AppConfig = {
  server: { host: '127.0.0.1', port: 8765 },
  workspaces: [],
  security: { max_file_bytes: 1000, max_response_bytes: 1000, max_request_bytes: 1000, max_search_results: 10, max_exec_ms: 120000 }
};

describe('git display hygiene', () => {
  it('leaves Git/URL results unsanitized by default', () => {
    const remote = 'https://user:secret@github.com/owner/repo.git';
    const output = 'token ghp_abc123TOKEN remote https://x-access-token:secret@github.com/owner/repo.git';
    expect(sanitizeGitRemoteForDisplay(remote)).toBe(remote);
    expect(redactGitOutputForDisplay(output)).toBe(output);
  });

  it('redacts exact known credential values without enabling heuristic result sanitization', () => {
    const output = 'known server-secret-value opaque ghp_LOOKS_SECRET_BUT_IS_NOT_KNOWN';
    const redacted = redactGitOutputForDisplay(output, false, ['server-secret-value']);
    expect(redacted).not.toContain('server-secret-value');
    expect(redacted).toContain('[GITHUB_TOKEN_REDACTED]');
    expect(redacted).toContain('ghp_LOOKS_SECRET_BUT_IS_NOT_KNOWN');
  });

  it('restores Git/URL result sanitization when explicitly enabled', () => {
    const output = 'token ghp_abc123TOKEN remote https://x-access-token:secret@github.com/owner/repo.git';
    expect(sanitizeGitRemoteForDisplay('https://user:secret@github.com/owner/repo.git', true)).toBe('https://github.com/owner/repo.git');
    expect(redactGitOutputForDisplay(output, true)).not.toContain('ghp_abc123TOKEN');
    expect(redactGitOutputForDisplay(output, true)).not.toContain('secret@');
    expect(redactGitOutputForDisplay(output, true)).toContain('[GITHUB_TOKEN_REDACTED]');
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

  it('always masks the configured GitHub token while leaving unrelated opaque output untouched', async () => {
    const repo = await fixtureRepo();
    const ws = workspace(repo.root, repo.tokenFile);
    ws.git = { ...ws.git, github_cli_wrapper: process.execPath };
    await writeFile(repo.tokenFile, 'github_pat_TESTSECRET\n');
    const script = "process.stdout.write(`${process.env.GH_TOKEN} ghp_NOT_THE_CONFIGURED_TOKEN ${process.argv.slice(1).join('|')}`)";
    const result = await githubCliTool(config, ws, ['-e', script, 'issue', 'list'], '.');
    const visible = JSON.stringify(result.data);
    expect(result.data).toMatchObject({ exit_code: 0, auth_lane: 'configured_wrapper' });
    expect(visible).not.toContain('github_pat_TESTSECRET');
    expect(visible).toContain('[GITHUB_TOKEN_REDACTED]');
    expect(visible).toContain('ghp_NOT_THE_CONFIGURED_TOKEN');
    expect(visible).toContain('issue|list');
  });

  it('redacts the configured GitHub token when secret-value redaction is explicitly enabled', async () => {
    const repo = await fixtureRepo();
    const ws = workspace(repo.root, repo.tokenFile);
    ws.git = { ...ws.git, github_cli_wrapper: process.execPath };
    await writeFile(repo.tokenFile, 'github_pat_TESTSECRET\n');
    const secured = { ...config, security: { ...config.security, secret_value_redaction: true } };
    const script = "process.stdout.write(process.env.GH_TOKEN ?? '')";
    const result = await githubCliTool(secured, ws, ['-e', script], '.');
    expect(JSON.stringify(result.data)).not.toContain('github_pat_TESTSECRET');
    expect(JSON.stringify(result.data)).toContain('[GITHUB_TOKEN_REDACTED]');
  });

  it('masks the exact derived Git Basic auth header without broad sanitization', async () => {
    const repo = await fixtureRepo();
    const ws = workspace(repo.root, repo.tokenFile);
    ws.git = { ...ws.git, git_cli: process.execPath };
    await writeFile(repo.tokenFile, 'github_pat_DERIVEDSECRET\n');
    const encoded = Buffer.from('x-access-token:github_pat_DERIVEDSECRET').toString('base64');
    const script = "const header = process.env.GIT_CONFIG_VALUE_0 || ''; const encoded = header.split(' ').pop() || ''; const decoded = Buffer.from(encoded, 'base64').toString('utf8'); process.stdout.write(header + ' ' + decoded + ' ghp_UNRELATED_OPAQUE')";
    const result = await gitCliTool(config, ws, ['-e', script]);
    const visible = JSON.stringify(result.data);
    expect(visible).not.toContain(encoded);
    expect(visible).not.toContain('github_pat_DERIVEDSECRET');
    expect(visible).toContain('[GITHUB_TOKEN_REDACTED]');
    expect(visible).toContain('ghp_UNRELATED_OPAQUE');
  });

  it('reports missing github token without exposing token path', async () => {
    const repo = await fixtureRepo();
    await expect(githubCliTool(config, workspace(repo.root, path.join(repo.root, 'missing-token.txt')), ['issue', 'list'], '.'))
      .rejects.toThrow('github auth diagnostic');
  });

  it('stages and commits local files with the configured PAT account identity', async () => {
    const repo = await fixtureRepo();
    const ws = workspace(repo.root, repo.tokenFile);
    ws.git = { ...ws.git, user_name: 'Calvin Chan', user_email: 'calvinchanht@gmail.com' };
    await writeFile(path.join(repo.root, 'card.png'), 'png-bytes');

    expect((await gitCliTool(config, ws, ['add', '--', 'card.png'])).data).toMatchObject({ exit_code: 0 });
    const commit = await gitCliTool(config, ws, ['commit', '-m', 'Add card art']);
    const author = spawnSync('git', ['log', '-1', '--format=%an <%ae>'], { cwd: repo.root, encoding: 'utf8' });

    expect(commit.data).toMatchObject({ exit_code: 0, auth_lane: 'configured_token_git_config_env', identity_lane: 'configured_workspace_identity' });
    expect(author.stdout.trim()).toBe('Calvin Chan <calvinchanht@gmail.com>');
  });

  it('verifies and uploads LFS objects before pushing the current branch', async () => {
    if (spawnSync('git', ['lfs', 'version']).status !== 0) return;
    const repo = await fixtureRepo();
    const remote = await mkdtemp(path.join(tmpdir(), 'gtp-lfs-remote-'));
    try {
      runGit(remote, ['init', '--bare']);
      runGit(repo.root, ['lfs', 'install', '--local']);
      await writeFile(path.join(repo.root, '.gitattributes'), '*.png filter=lfs diff=lfs merge=lfs -text\n');
      await writeFile(path.join(repo.root, 'card.png'), Buffer.alloc(4096, 7));
      runGit(repo.root, ['add', '.gitattributes', 'card.png']);
      runGit(repo.root, ['commit', '-m', 'Add LFS card']);
      runGit(repo.root, ['remote', 'add', 'origin', remote]);
      const branch = spawnSync('git', ['branch', '--show-current'], { cwd: repo.root, encoding: 'utf8' }).stdout.trim();
      const result = await gitLfsPublishCurrentBranch(config, workspace(repo.root, repo.tokenFile), '.', 'origin', branch);
      const pointer = spawnSync('git', ['--git-dir', remote, 'show', `${branch}:card.png`], { encoding: 'utf8' });

      expect(result.data).toMatchObject({ status: 'pushed', branch, auth_lane: 'configured_token_git_config_env' });
      expect(result.data.steps.map((step: { command: string[] }) => step.command)).toContainEqual(['git', 'lfs', 'fsck', '--pointers', 'HEAD']);
      expect(result.data.steps.map((step: { command: string[] }) => step.command)).toContainEqual(['git', 'lfs', 'push', 'origin', branch]);
      expect(pointer.stdout).toContain('https://git-lfs.github.com/spec/v1');

      const oid = pointer.stdout.match(/oid sha256:([0-9a-f]{64})/)?.[1];
      expect(oid).toBeTruthy();
      await rm(path.join(repo.root, '.git', 'lfs', 'objects', oid!.slice(0, 2), oid!.slice(2, 4), oid!), { force: true });
      await writeFile(path.join(repo.root, 'card-2.png'), Buffer.alloc(4096, 9));
      runGit(repo.root, ['add', 'card-2.png']);
      runGit(repo.root, ['commit', '-m', 'Add second LFS card']);

      const partialCloneResult = await gitPushCurrentBranch(config, workspace(repo.root, repo.tokenFile), '.', 'origin', branch);
      expect(partialCloneResult.data).toMatchObject({ status: 'pushed', branch, publish_mode: 'git_lfs', auto_selected: true });
      expect(partialCloneResult.data.steps.map((step: { command: string[] }) => step.command)).toContainEqual(['git', 'lfs', 'install', '--local']);
    } finally {
      await rm(repo.root, { recursive: true, force: true });
      await rm(remote, { recursive: true, force: true });
    }
  }, 30000);

  it('initializes LFS before creating an isolated worktree', async () => {
    if (spawnSync('git', ['lfs', 'version']).status !== 0) return;
    const repo = await fixtureRepo();
    const worktree = await mkdtemp(path.join(tmpdir(), 'gtp-lfs-worktree-'));
    await rm(worktree, { recursive: true, force: true });
    try {
      await writeFile(path.join(repo.root, '.gitattributes'), '*.png filter=lfs diff=lfs merge=lfs -text\n');
      runGit(repo.root, ['add', '.gitattributes']);
      runGit(repo.root, ['commit', '-m', 'Configure LFS']);
      const result = await gitCliTool(config, workspace(repo.root, repo.tokenFile), ['worktree', 'add', '-b', 'feature/lfs-worktree', worktree]);
      const filter = spawnSync('git', ['config', '--local', '--get', 'filter.lfs.process'], { cwd: repo.root, encoding: 'utf8' });

      expect(result.data).toMatchObject({ exit_code: 0, lfs_initialized: true });
      expect(filter.stdout).toContain('git-lfs filter-process');
    } finally {
      spawnSync('git', ['worktree', 'remove', '--force', worktree], { cwd: repo.root, encoding: 'utf8' });
      await rm(repo.root, { recursive: true, force: true });
      await rm(worktree, { recursive: true, force: true });
    }
  });

  it('exposes github through the /ota/api/v1/gh HTTP alias', async () => {
    const repo = await fixtureRepo();
    await writeFile(repo.tokenFile, 'github_pat_TESTSECRET\n');
    const server: Server = createServer(createHttpRequestHandler(configForGithub(repo.root, repo.tokenFile)));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('expected TCP address');
      const script = "process.stdout.write(`${process.env.GH_TOKEN} ${process.argv.slice(1).join('|')}`)";
      const response = await fetch(`http://127.0.0.1:${address.port}/ota/api/v1/gh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspace_id: 'anna', cmd_array: ['-e', script, 'issue', 'view', '40'], async_mode: 'sync' })
      });
      const body = await response.json() as { ok: boolean; data: { output: string } };
      expect(body.ok).toBe(true);
      expect(body.data.output).toContain('issue|view|40');
      expect(body.data.output).not.toContain('github_pat_TESTSECRET');
      expect(body.data.output).toContain('[GITHUB_TOKEN_REDACTED]');
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      await rm(repo.root, { recursive: true, force: true });
    }
  });

  it('dispatches git_push_current_branch through the HTTP tool facade', async () => {
    const repo = await fixtureRepo();
    const server: Server = createServer(createHttpRequestHandler(configForGithub(repo.root, repo.tokenFile)));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('expected TCP address');
      const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/tool`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tool: 'git_push_current_branch', arguments: { workspace_id: 'anna', repo_path: '.' } })
      });
      const body = await response.json() as { ok: boolean; summary: string };
      expect(body.ok).toBe(false);
      expect(body.summary).toContain('git remote diagnostic');
      expect(body.summary).not.toContain('unsupported API tool');
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      await rm(repo.root, { recursive: true, force: true });
    }
  });

  it('dispatches generic git argv through the HTTP tool facade', async () => {
    const repo = await fixtureRepo();
    const server: Server = createServer(createHttpRequestHandler(configForGithub(repo.root, repo.tokenFile)));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('expected TCP address');
      const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/tool`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tool: 'git', arguments: { workspace_id: 'anna', cmd_array: ['status', '--short'], async_mode: 'sync' } })
      });
      const body = await response.json() as { ok: boolean; data: { exit_code: number; command: string[] } };
      expect(body.ok).toBe(true);
      expect(body.data).toMatchObject({ exit_code: 0, command: ['git', 'status', '--short'] });
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      await rm(repo.root, { recursive: true, force: true });
    }
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

function configForGithub(root: string, tokenFile: string): AppConfig {
  return {
    ...config,
    server: { host: '127.0.0.1', port: 0, auth: { enabled: false, bearer_token_env: 'TEST_TOKEN', allow_loopback_without_auth: true }, rate_limit: { enabled: false, window_ms: 60000, max_requests: 120, trust_proxy_headers: false }, tool_annotations: { mode: 'honest' }, exposed_tools: [] },
    workspaces: [{ ...workspace(root, tokenFile), id: 'anna', git: { github_token_file: tokenFile, github_cli_wrapper: process.execPath } }],
    brokered_executors: { enabled: false, include_action_schema: false, default_ttl_ms: 60000, default_lease_ms: 30000, executors: [] }
  };
}

function runGit(cwd: string, args: string[]): void {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `git ${args.join(' ')} failed`);
}
