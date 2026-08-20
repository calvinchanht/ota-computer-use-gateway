import { createServer, type Server } from 'node:http';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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

  it('masks the configured token in Git LFS remote_url without broad sanitization', async () => {
    if (spawnSync('git', ['lfs', 'version']).status !== 0) return;
    const repo = await fixtureRepo();
    const token = 'ota-known-lfs-secret-value';
    try {
      await writeFile(repo.tokenFile, token + '\n');
      runGit(repo.root, ['lfs', 'install', '--local']);
      await writeFile(path.join(repo.root, '.gitattributes'), '*.png filter=lfs diff=lfs merge=lfs -text\n');
      await writeFile(path.join(repo.root, 'card.png'), Buffer.alloc(1024, 3));
      runGit(repo.root, ['add', '.gitattributes', 'card.png']);
      runGit(repo.root, ['commit', '-m', 'Add LFS credential masking fixture']);
      runGit(repo.root, ['remote', 'add', 'origin', `https://x-access-token:${token}@127.0.0.1:9/repo.git`]);
      const branch = spawnSync('git', ['branch', '--show-current'], { cwd: repo.root, encoding: 'utf8' }).stdout.trim();

      const result = await gitLfsPublishCurrentBranch(config, workspace(repo.root, repo.tokenFile), '.', 'origin', branch);
      const visible = JSON.stringify(result.data);
      expect(visible).not.toContain(token);
      expect((result.data as { remote_url: string }).remote_url).toContain('[GITHUB_TOKEN_REDACTED]');
    } finally {
      await rm(repo.root, { recursive: true, force: true });
    }
  });

  it('reports missing github token without exposing token path', async () => {
    const repo = await fixtureRepo();
    await expect(githubCliTool(config, workspace(repo.root, path.join(repo.root, 'missing-token.txt')), ['issue', 'list'], '.'))
      .rejects.toThrow('github auth diagnostic');
  });

  it('preflights fixed rate-limit JSON and skips the original argv below the selected floor', async () => {
    const repo = await fixtureRepo();
    const fake = await fakeGithubWrapper(repo.root, {
      preflight: { code: 0, stdout: JSON.stringify({ resources: { core: { limit: 60, used: 60, remaining: 0, reset: 2000000000 } } }) },
      commands: [{ code: 0, stdout: 'must-not-run' }]
    });
    const ws = workspace(repo.root, repo.tokenFile);
    ws.git = { ...ws.git, github_cli_wrapper: fake.wrapper };

    const command = ['api', 'repos/owner/repo', '--header=Authorization: Bearer synthetic-skip-auth'];
    const result = await githubCliTool(config, ws, command, '.', 5000, 20000, {
      preflight: true,
      resource: 'core',
      min_remaining: 1
    });
    const data = result.data as { command: string[]; output: string; rate_budget: Record<string, unknown> };
    expect(result.summary).toBe('github command skipped by rate budget');
    expect(data.output).toBe('');
    expect(data.command).toEqual(['gh', 'api', 'repos/owner/repo', '--header=Authorization: [AUTHORIZATION_REDACTED]']);
    expect(JSON.stringify(data.command)).not.toContain('synthetic-skip-auth');
    expect(data.rate_budget).toMatchObject({
      classification: 'primary_exhausted',
      resource: 'core',
      limit: 60,
      remaining: 0,
      used: 60,
      reset_at: '2033-05-18T03:33:20.000Z',
      automatic_retry_count: 0,
      execution: 'skipped_rate_budget'
    });
    expect(await fakeGithubInvocations(fake.marker)).toEqual([['api', 'rate_limit']]);
  });

  it('executes the original argv once when the selected preflight budget is sufficient', async () => {
    const repo = await fixtureRepo();
    const fake = await fakeGithubWrapper(repo.root, {
      preflight: { code: 0, stdout: JSON.stringify({ resources: { search: { limit: 30, used: 3, remaining: 27, reset: 2000000000 } } }) },
      commands: [{ code: 0, stdout: 'search-ok' }]
    });
    const ws = workspace(repo.root, repo.tokenFile);
    ws.git = { ...ws.git, github_cli_wrapper: fake.wrapper };

    const result = await githubCliTool(config, ws, ['api', 'search/issues'], '.', 5000, 20000, {
      preflight: true,
      resource: 'search',
      min_remaining: 5
    });
    const data = result.data as { output: string; rate_budget: Record<string, unknown> };
    expect(data.output).toBe('search-ok');
    expect(data.rate_budget).toMatchObject({ classification: 'ok', resource: 'search', remaining: 27, execution: 'executed' });
    expect(await fakeGithubInvocations(fake.marker)).toEqual([['api', 'rate_limit'], ['api', 'search/issues']]);
  });

  it('classifies synthetic primary exhaustion and never replays it', async () => {
    const repo = await fixtureRepo();
    const fake = await fakeGithubWrapper(repo.root, {
      commands: [
        { code: 1, stderr: 'gh: API rate limit exceeded for user (HTTP 403)\nX-RateLimit-Reset: 2000000000\n' },
        { code: 0, stdout: 'must-not-retry' }
      ]
    });
    const ws = workspace(repo.root, repo.tokenFile);
    ws.git = { ...ws.git, github_cli_wrapper: fake.wrapper };

    const result = await githubCliTool(config, ws, ['api', 'repos/owner/repo'], '.', 5000, 20000, {
      retry_mode: 'safe_read_once',
      max_wait_ms: 100
    });
    const data = result.data as { rate_budget: Record<string, unknown> };
    expect(data.rate_budget).toMatchObject({
      classification: 'primary_exhausted',
      safe_to_replay: true,
      automatic_retry_count: 0,
      reset_at: '2033-05-18T03:33:20.000Z'
    });
    expect(await fakeGithubInvocations(fake.marker)).toEqual([['api', 'repos/owner/repo']]);
  });

  it('gives primary exhaustion precedence over mixed secondary-limit retry evidence and never replays it', async () => {
    const repo = await fixtureRepo();
    const fake = await fakeGithubWrapper(repo.root, {
      commands: [
        {
          code: 1,
          stderr: 'gh: You have exceeded a secondary rate limit. Retry-After: 0.01 seconds (HTTP 403)\nX-RateLimit-Remaining: 0\nX-RateLimit-Reset: 2000000000\n'
        },
        { code: 0, stdout: 'must-not-retry' }
      ]
    });
    const ws = workspace(repo.root, repo.tokenFile);
    ws.git = { ...ws.git, github_cli_wrapper: fake.wrapper };

    const command = ['api', 'repos/owner/repo'];
    const result = await githubCliTool(config, ws, command, '.', 5000, 20000, {
      retry_mode: 'safe_read_once',
      max_wait_ms: 100
    });
    const data = result.data as { rate_budget: Record<string, unknown> };
    expect(data.rate_budget).toMatchObject({
      classification: 'primary_exhausted',
      retry_after_ms: 10,
      safe_to_replay: true,
      automatic_retry_count: 0,
      reset_at: '2033-05-18T03:33:20.000Z'
    });
    expect(await fakeGithubInvocations(fake.marker)).toEqual([command]);
  });

  it.each([
    ['implicit GET', ['api', 'repos/owner/repo']],
    ['paginated GET', ['api', 'repos/owner/repo/issues', '--paginate']],
    ['explicit HEAD', ['api', '--method', 'HEAD', 'repos/owner/repo']]
  ])('retries one provably safe REST %s exactly once on a concrete secondary-limit hint', async (_name, command) => {
    const repo = await fixtureRepo();
    const fake = await fakeGithubWrapper(repo.root, {
      commands: [
        { code: 1, stderr: 'gh: You have exceeded a secondary rate limit. Retry-After: 0.01 seconds (HTTP 403)\n' },
        { code: 0, stdout: 'retry-success' }
      ]
    });
    const ws = workspace(repo.root, repo.tokenFile);
    ws.git = { ...ws.git, github_cli_wrapper: fake.wrapper };

    const result = await githubCliTool(config, ws, command, '.', 5000, 20000, {
      retry_mode: 'safe_read_once',
      max_wait_ms: 100
    });
    const data = result.data as { output: string; rate_budget: Record<string, unknown> };
    expect(data.output).toBe('retry-success');
    expect(data.rate_budget).toMatchObject({
      classification: 'secondary_limited',
      retry_after_ms: 10,
      safe_to_replay: true,
      automatic_retry_count: 1,
      execution: 'executed'
    });
    expect(await fakeGithubInvocations(fake.marker)).toEqual([command, command]);
  });

  it.each([
    ['REST POST', ['api', '--method', 'POST', 'repos/owner/repo']],
    ['REST PATCH', ['api', '-X', 'PATCH', 'repos/owner/repo']],
    ['REST PUT', ['api', '--method=PUT', 'repos/owner/repo']],
    ['REST DELETE', ['api', '-XDELETE', 'repos/owner/repo']],
    ['implicit -f POST', ['api', 'repos/owner/repo', '-f', 'name=value']],
    ['implicit -F POST', ['api', 'repos/owner/repo', '-Fname=value']],
    ['implicit --field POST', ['api', 'repos/owner/repo', '--field=name=value']],
    ['implicit --raw-field POST', ['api', 'repos/owner/repo', '--raw-field', 'name=value']],
    ['implicit --input POST', ['api', 'repos/owner/repo', '--input', 'body.json']],
    ['GraphQL', ['api', 'graphql', '-f', 'query={viewer{login}}']],
    ['native gh command', ['issue', 'list']]
  ])('never auto-retries %s after a synthetic secondary-limit response', async (_name, command) => {
    const repo = await fixtureRepo();
    const fake = await fakeGithubWrapper(repo.root, {
      commands: [
        { code: 1, stderr: 'gh: abuse detection mechanism triggered. Retry-After: 0.01 seconds (HTTP 403)\n' },
        { code: 0, stdout: 'must-not-retry' }
      ]
    });
    const ws = workspace(repo.root, repo.tokenFile);
    ws.git = { ...ws.git, github_cli_wrapper: fake.wrapper };

    const result = await githubCliTool(config, ws, command, '.', 5000, 20000, {
      retry_mode: 'safe_read_once',
      max_wait_ms: 100
    });
    const data = result.data as { rate_budget: Record<string, unknown> };
    expect(data.rate_budget).toMatchObject({ classification: 'secondary_limited', safe_to_replay: false, automatic_retry_count: 0 });
    expect(await fakeGithubInvocations(fake.marker)).toEqual([command]);
  });

  it('classifies ambiguous 429 output as caller-controlled and never blindly replays it', async () => {
    const repo = await fixtureRepo();
    const fake = await fakeGithubWrapper(repo.root, {
      commands: [
        { code: 1, stderr: 'gh: request failed (HTTP 429)\n' },
        { code: 0, stdout: 'must-not-retry' }
      ]
    });
    const ws = workspace(repo.root, repo.tokenFile);
    ws.git = { ...ws.git, github_cli_wrapper: fake.wrapper };

    const result = await githubCliTool(config, ws, ['api', 'repos/owner/repo'], '.', 5000, 20000, {
      retry_mode: 'safe_read_once',
      max_wait_ms: 100
    });
    const data = result.data as { rate_budget: Record<string, unknown> };
    expect(data.rate_budget).toMatchObject({ classification: 'rate_limited_unknown', safe_to_replay: true, automatic_retry_count: 0 });
    expect(await fakeGithubInvocations(fake.marker)).toEqual([['api', 'repos/owner/repo']]);
  });

  it('preserves the exact legacy result keys and command echo when rate_policy is absent', async () => {
    const repo = await fixtureRepo();
    const fake = await fakeGithubWrapper(repo.root, { commands: [{ code: 0, stdout: 'legacy-output' }] });
    const ws = workspace(repo.root, repo.tokenFile);
    ws.git = { ...ws.git, github_cli_wrapper: fake.wrapper };

    const command = ['api', 'repos/owner/repo', '--header=Authorization: Bearer synthetic-legacy-auth'];
    const result = await githubCliTool(config, ws, command, '.');
    const data = result.data as Record<string, unknown>;
    expect(Object.keys(data).sort()).toEqual(['auth_lane', 'command', 'cwd', 'exit_code', 'output', 'timed_out', 'truncated']);
    expect(data.command).toEqual(['gh', ...command]);
    expect(JSON.stringify(data.command)).toContain('synthetic-legacy-auth');
    expect(data.output).toBe('legacy-output');
    expect(data).not.toHaveProperty('rate_budget');
    expect(await fakeGithubInvocations(fake.marker)).toEqual([command]);
  });

  it.each([
    ['short split', ['-H', 'Authorization: Bearer synthetic-short-split'], 'synthetic-short-split'],
    ['long split', ['--header', 'authorization: token synthetic-long-split'], 'synthetic-long-split'],
    ['long equals', ['--header=Authorization: Bearer synthetic-long-equals'], 'synthetic-long-equals'],
    ['short equals', ['-H=Authorization: Bearer synthetic-short-equals'], 'synthetic-short-equals'],
    ['short attached', ['-HProxy-Authorization: Bearer synthetic-short-attached'], 'synthetic-short-attached']
  ])('redacts policy-enabled %s authorization header argv from returned command without changing execution argv', async (_name, headerArgs, marker) => {
    const repo = await fixtureRepo();
    const fake = await fakeGithubWrapper(repo.root, { commands: [{ code: 0, stdout: 'policy-output' }] });
    const ws = workspace(repo.root, repo.tokenFile);
    ws.git = { ...ws.git, github_cli_wrapper: fake.wrapper };

    const command = ['api', 'repos/owner/repo', ...(headerArgs as string[])];
    const result = await githubCliTool(config, ws, command, '.', 5000, 20000, {});
    const data = result.data as { command: string[]; rate_budget: Record<string, unknown> };
    const visibleCommand = JSON.stringify(data.command);
    expect(visibleCommand).toContain('[AUTHORIZATION_REDACTED]');
    expect(visibleCommand).not.toContain(marker as string);
    expect(data.rate_budget).toMatchObject({ classification: 'not_checked', execution: 'executed' });
    expect(await fakeGithubInvocations(fake.marker)).toEqual([command]);
  });

  it('redacts configured-token and raw authorization-header material from policy-enabled output', async () => {
    const repo = await fixtureRepo();
    await writeFile(repo.tokenFile, 'github_pat_RATEPOLICYSECRET\n');
    const fake = await fakeGithubWrapper(repo.root, {
      commands: [{ code: 0, stdout: 'github_pat_RATEPOLICYSECRET\nAuthorization: Bearer synthetic-auth-material\nopaque-output' }]
    });
    const ws = workspace(repo.root, repo.tokenFile);
    ws.git = { ...ws.git, github_cli_wrapper: fake.wrapper };

    const result = await githubCliTool(config, ws, ['api', 'repos/owner/repo'], '.', 5000, 20000, {});
    const data = result.data as { output: string; rate_budget: Record<string, unknown> };
    expect(data.output).toContain('[GITHUB_TOKEN_REDACTED]');
    expect(data.output).toContain('Authorization: [AUTHORIZATION_REDACTED]');
    expect(data.output).toContain('opaque-output');
    expect(data.output).not.toContain('github_pat_RATEPOLICYSECRET');
    expect(data.output).not.toContain('synthetic-auth-material');
    expect(data.rate_budget).toMatchObject({ classification: 'not_checked', execution: 'executed' });
  });

  it('keeps bounded safe-read retry waits inside the existing quota-saver run contract', async () => {
    const repo = await fixtureRepo();
    const fake = await fakeGithubWrapper(repo.root, {
      commands: [
        { code: 1, stderr: 'gh: You have exceeded a secondary rate limit. Retry-After: 0.05 seconds (HTTP 403)\n' },
        { code: 0, stdout: 'async-retry-success' }
      ]
    });
    const server: Server = createServer(createHttpRequestHandler(configForGithub(repo.root, repo.tokenFile, fake.wrapper)));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('expected TCP address');
      const response = await fetch(`http://127.0.0.1:${address.port}/ota/api/v1/gh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workspace_id: 'anna',
          cmd_array: ['api', 'repos/owner/repo'],
          timeout_ms: 5000,
          initial_wait_ms: 0,
          rate_policy: { retry_mode: 'safe_read_once', max_wait_ms: 100 }
        })
      });
      const queued = await response.json() as { api: { run_id: string; status: string } };
      expect(response.status).toBe(202);
      expect(queued.api.status).toBe('running');

      let completed: any;
      for (let attempt = 0; attempt < 100; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        const polled = await fetch(`http://127.0.0.1:${address.port}/api/v1/runs/${queued.api.run_id}`);
        completed = await polled.json();
        if (completed.run?.status === 'completed') break;
      }
      expect(completed.run?.status).toBe('completed');
      expect(completed.run?.response?.data?.output).toBe('async-retry-success');
      expect(completed.run?.response?.data?.rate_budget).toMatchObject({ automatic_retry_count: 1, safe_to_replay: true });
      expect(await fakeGithubInvocations(fake.marker)).toEqual([['api', 'repos/owner/repo'], ['api', 'repos/owner/repo']]);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      await rm(repo.root, { recursive: true, force: true });
    }
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

type FakeGithubResponse = { code?: number; stdout?: string; stderr?: string };
type FakeGithubScenario = { preflight?: FakeGithubResponse; commands?: FakeGithubResponse[] };

async function fakeGithubWrapper(root: string, scenario: FakeGithubScenario) {
  const wrapper = path.join(root, 'fake-gh.mjs');
  const scenarioPath = path.join(root, 'fake-gh-scenario.json');
  const statePath = path.join(root, 'fake-gh-state.json');
  const marker = path.join(root, 'fake-gh-invocations.jsonl');
  await writeFile(scenarioPath, JSON.stringify(scenario));
  await writeFile(statePath, JSON.stringify({ command_index: 0 }));
  await writeFile(wrapper, `#!/usr/bin/env node\nimport { appendFileSync, readFileSync, writeFileSync } from 'node:fs';\nconst scenarioPath = ${JSON.stringify(scenarioPath)};\nconst statePath = ${JSON.stringify(statePath)};\nconst markerPath = ${JSON.stringify(marker)};\nconst args = process.argv.slice(2);\nappendFileSync(markerPath, JSON.stringify(args) + '\\n');\nconst scenario = JSON.parse(readFileSync(scenarioPath, 'utf8'));\nlet response;\nif (args[0] === 'api' && args[1] === 'rate_limit') {\n  response = scenario.preflight ?? { code: 0, stdout: '{}' };\n} else {\n  const state = JSON.parse(readFileSync(statePath, 'utf8'));\n  const commands = scenario.commands ?? [];\n  response = commands[Math.min(state.command_index, Math.max(commands.length - 1, 0))] ?? { code: 0, stdout: '' };\n  state.command_index += 1;\n  writeFileSync(statePath, JSON.stringify(state));\n}\nif (response.stdout) process.stdout.write(String(response.stdout));\nif (response.stderr) process.stderr.write(String(response.stderr));\nprocess.exit(Number.isInteger(response.code) ? response.code : 0);\n`);
  await chmod(wrapper, 0o755);
  return { wrapper, marker };
}

async function fakeGithubInvocations(marker: string): Promise<string[][]> {
  const text = await readFile(marker, 'utf8');
  return text.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as string[]);
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

function configForGithub(root: string, tokenFile: string, githubCliWrapper = process.execPath): AppConfig {
  return {
    ...config,
    server: { host: '127.0.0.1', port: 0, auth: { enabled: false, bearer_token_env: 'TEST_TOKEN', allow_loopback_without_auth: true }, rate_limit: { enabled: false, window_ms: 60000, max_requests: 120, trust_proxy_headers: false }, tool_annotations: { mode: 'honest' }, exposed_tools: [] },
    workspaces: [{ ...workspace(root, tokenFile), id: 'anna', git: { github_token_file: tokenFile, github_cli_wrapper: githubCliWrapper } }],
    brokered_executors: { enabled: false, include_action_schema: false, default_ttl_ms: 60000, default_lease_ms: 30000, executors: [] }
  };
}

function runGit(cwd: string, args: string[]): void {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `git ${args.join(' ')} failed`);
}
