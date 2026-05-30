import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readBinaryFileTool, statPath, treeTool, writeBinaryFileTool } from '../src/tools/files.js';
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

  it('reads binary files as base64 with metadata', async () => {
    const workspace = await fixtureWorkspace(true);
    await writeFile(path.join(workspace.realRoot, 'image.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const result = await readBinaryFileTool(config, workspace, 'image.png');
    expect(result.data).toMatchObject({ path: 'image.png', bytes: 4, media_type: 'image/png', base64: 'iVBORw==' });
  });

  it('writes binary files from base64 content', async () => {
    const workspace = await fixtureWorkspace(true);
    const result = await writeBinaryFileTool(config, workspace, 'out/file.zip', 'UEsDBA==');
    await expect(readFile(path.join(workspace.realRoot, 'out/file.zip'))).resolves.toEqual(Buffer.from('UEsDBA==', 'base64'));
    expect(result.data).toMatchObject({ path: 'out/file.zip', bytes: 4, media_type: 'application/zip' });
  });

  it('returns a bounded recursive tree', async () => {
    const workspace = await fixtureWorkspace();
    await mkdir(path.join(workspace.realRoot, 'src'), { recursive: true });
    await writeFile(path.join(workspace.realRoot, 'src', 'index.ts'), 'hello');
    const result = await treeTool(config, workspace, '.', 10);
    expect(JSON.stringify(result.data)).toContain('src/index.ts');
  });
});

async function fixtureWorkspace(allowWrite = false): Promise<Workspace> {
  const root = await mkdtemp(path.join(tmpdir(), 'gtp-file-'));
  return { id: 'test', name: 'Test', root, realRoot: root, allow_read: true, allow_write: allowWrite, allow_patch: false, allow_tests: false, allow_screen: false, allow_mouse_keyboard: false, browser: { profiles: [] }, commands: {} };
}
