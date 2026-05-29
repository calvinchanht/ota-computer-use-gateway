import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { statPath, treeTool } from '../src/tools/files.js';
import type { AppConfig } from '../src/config/schema.js';
import type { Workspace } from '../src/core/workspaces.js';

const config: AppConfig = {
  server: { host: '127.0.0.1', port: 8765 },
  workspaces: [],
  security: { max_file_bytes: 1000, max_response_bytes: 1000, max_request_bytes: 1000, max_search_results: 10, max_exec_ms: 120000, denied_globs: [] }
};

describe('file primitive tools', () => {
  it('returns file metadata', async () => {
    const workspace = await fixtureWorkspace();
    await writeFile(path.join(workspace.realRoot, 'note.txt'), 'hello');
    const result = await statPath(config, workspace, 'note.txt');
    expect(result.data).toMatchObject({ path: 'note.txt', type: 'file', size: 5 });
  });

  it('returns a bounded recursive tree', async () => {
    const workspace = await fixtureWorkspace();
    await mkdir(path.join(workspace.realRoot, 'src'), { recursive: true });
    await writeFile(path.join(workspace.realRoot, 'src', 'index.ts'), 'hello');
    const result = await treeTool(config, workspace, '.', 10);
    expect(JSON.stringify(result.data)).toContain('src/index.ts');
  });
});

async function fixtureWorkspace(): Promise<Workspace> {
  const root = await mkdtemp(path.join(tmpdir(), 'gtp-file-'));
  return { id: 'test', name: 'Test', root, realRoot: root, allow_read: true, allow_write: false, allow_patch: false, allow_tests: false, allow_screen: false, allow_mouse_keyboard: false, commands: {} };
}
