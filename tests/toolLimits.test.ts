import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readFileTool } from '../src/tools/files.js';
import type { AppConfig } from '../src/config/schema.js';
import type { Workspace } from '../src/core/workspaces.js';

const config: AppConfig = {
  server: { host: '127.0.0.1', port: 8765 },
  workspaces: [],
  security: { max_file_bytes: 20, max_response_bytes: 50, max_request_bytes: 1000, max_search_results: 10, max_exec_ms: 120000, denied_globs: [] }
};

describe('tool limits', () => {
  it('rejects large files', async () => {
    const workspace = await fixtureWorkspace();
    await writeFile(path.join(workspace.realRoot, 'big.txt'), 'x'.repeat(30));
    await expect(readFileTool(config, workspace, 'big.txt')).rejects.toThrow('max bytes');
  });

  it('rejects binary files', async () => {
    const workspace = await fixtureWorkspace();
    await writeFile(path.join(workspace.realRoot, 'bin.dat'), Buffer.from([1, 0, 2]));
    await expect(readFileTool(config, workspace, 'bin.dat')).rejects.toThrow('binary');
  });
});

async function fixtureWorkspace(): Promise<Workspace> {
  const root = await mkdtemp(path.join(tmpdir(), 'gtp-limits-'));
  return { id: 'test', name: 'Test', root, realRoot: root, allow_read: true, allow_write: false, allow_patch: false, allow_tests: false, allow_screen: false, allow_mouse_keyboard: false, browser: { profiles: [] }, commands: {} };
}
