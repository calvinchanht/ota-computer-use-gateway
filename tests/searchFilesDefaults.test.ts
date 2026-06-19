import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { searchFiles } from '../src/tools/largeFiles.js';
import type { AppConfig } from '../src/config/schema.js';
import type { Workspace } from '../src/core/workspaces.js';

const config: AppConfig = {
  server: { host: '127.0.0.1', port: 8765, rate_limit: { enabled: false, window_ms: 60000, max_requests: 120, trust_proxy_headers: false }, auth: { enabled: false, bearer_token_env: 'TEST', allow_loopback_without_auth: true } },
  workspaces: [],
  security: { max_file_bytes: 1000000, max_response_bytes: 1000000, max_request_bytes: 1000000, max_search_results: 50, max_exec_ms: 120000 }
};

describe('searchFiles defaults', () => {
  it('skips heavy workspace directories during broad searches', async () => {
    const workspace = await fixtureWorkspace();
    await mkdir(join(workspace.realRoot, 'docs'), { recursive: true });
    await mkdir(join(workspace.realRoot, '.browser-profiles'), { recursive: true });
    await mkdir(join(workspace.realRoot, 'data'), { recursive: true });
    await writeFile(join(workspace.realRoot, 'docs', 'runbook.md'), 'canonical script');
    await writeFile(join(workspace.realRoot, '.browser-profiles', 'noise.txt'), 'canonical script');
    await writeFile(join(workspace.realRoot, 'data', 'noise.txt'), 'canonical script');
    const result = await searchFiles(config, workspace, '.', 'canonical script');
    expect(result.data?.matches).toHaveLength(1);
    expect(JSON.stringify(result.data?.matches)).toContain('docs/runbook.md');
  });
});

async function fixtureWorkspace(): Promise<Workspace> {
  const root = await mkdtemp(join(tmpdir(), 'ota-search-defaults-'));
  return { id: 'test', name: 'Test', root, realRoot: root, allow_read: true, allow_write: true, allow_patch: true, allow_tests: true, allow_screen: false, allow_mouse_keyboard: false, browser: { profiles: [] }, commands: {} };
}
