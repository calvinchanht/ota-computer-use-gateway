import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { requiredTextArg } from '../src/server/http.js';
import { editFileTool, readBinaryFileTool, statPath, treeTool, writeBinaryFileTool, writeFileTool } from '../src/tools/files.js';
import type { AppConfig } from '../src/config/schema.js';
import type { Workspace } from '../src/core/workspaces.js';

const config: AppConfig = {
  server: { host: '127.0.0.1', port: 8765 },
  workspaces: [],
  security: { max_file_bytes: 1000, max_response_bytes: 1000, max_request_bytes: 1000, max_search_results: 10, max_exec_ms: 120000, denied_globs: [] }
};

describe('file primitive tools', () => {
  it('returns file metadata with workspace scope', async () => {
    const workspace = await fixtureWorkspace();
    await writeFile(path.join(workspace.realRoot, 'note.txt'), 'hello');
    const result = await statPath(config, workspace, 'note.txt');
    expect(result.data).toMatchObject({ path: 'note.txt', scope: 'workspace', type: 'file', size: 5 });
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

  it('writes JSON-looking UTF-8 content without extra serialization', async () => {
    const workspace = await fixtureWorkspace(true);
    const content = JSON.stringify({ message: 'hello "quoted" value', slash: 'a\\b', lines: ['one', 'two'] }, null, 2);
    await writeFileTool(config, workspace, 'data.json', content, true);
    await expect(readFile(path.join(workspace.realRoot, 'data.json'), 'utf8')).resolves.toBe(content);
  });

  it('allows empty text writes and empty edit replacements', async () => {
    const workspace = await fixtureWorkspace(true);
    await writeFileTool(config, workspace, 'empty.txt', '', true);
    await writeFile(path.join(workspace.realRoot, 'delete-me.txt'), 'keep\nremove\n');
    await editFileTool(config, workspace, 'delete-me.txt', 'remove\n', '');
    await expect(readFile(path.join(workspace.realRoot, 'empty.txt'), 'utf8')).resolves.toBe('');
    await expect(readFile(path.join(workspace.realRoot, 'delete-me.txt'), 'utf8')).resolves.toBe('keep\n');
  });

  it('returns corrective diagnostics for object content fields', () => {
    expect(() => requiredTextArg({ nested: true }, 'content', true))
      .toThrow(/serialize it once into a string/);
  });

  it('returns corrective diagnostics for array content fields', () => {
    expect(() => requiredTextArg(['one', 'two'], 'content', true))
      .toThrow(/received array/);
  });


  it('uses host scope for machine_admin absolute reads and keeps workspace-only agents scoped', async () => {
    const workspaceOnly = await fixtureWorkspace();
    const machineAdmin = await fixtureWorkspace(false, true);
    const outsideRoot = await mkdtemp(path.join(tmpdir(), 'gtp-host-'));
    const outside = path.join(outsideRoot, 'host-note.txt');
    await writeFile(outside, 'host ok');

    await expect(statPath(config, workspaceOnly, outside)).rejects.toThrow('workspace-relative');
    const result = await statPath(config, machineAdmin, outside);
    expect(result.data).toMatchObject({ path: outside, scope: 'host', type: 'file', size: 7 });
  });

  it('allows machine_admin writes and routine deletes in host scope', async () => {
    const workspace = await fixtureWorkspace(true, true);
    const outsideRoot = await mkdtemp(path.join(tmpdir(), 'gtp-host-write-'));
    const outside = path.join(outsideRoot, 'tmp', 'note.txt');
    const wrote = await writeFileTool(config, workspace, outside, 'tmp cleanup ok', true);
    expect(wrote.data).toMatchObject({ path: outside, scope: 'host', bytes: 14 });
    const deleted = await import('../src/tools/files.js').then((tools) => tools.deletePathTool(config, workspace, path.join(outsideRoot, 'tmp'), true));
    expect(deleted.data).toMatchObject({ path: path.join(outsideRoot, 'tmp'), scope: 'host', type: 'dir', recursive: true });
  });

  it('returns a bounded recursive tree', async () => {
    const workspace = await fixtureWorkspace();
    await mkdir(path.join(workspace.realRoot, 'src'), { recursive: true });
    await writeFile(path.join(workspace.realRoot, 'src', 'index.ts'), 'hello');
    const result = await treeTool(config, workspace, '.', 10);
    expect(JSON.stringify(result.data)).toContain('src/index.ts');
  });
});

async function fixtureWorkspace(allowWrite = false, machineAdmin = false): Promise<Workspace> {
  const root = await mkdtemp(path.join(tmpdir(), 'gtp-file-'));
  return { id: 'test', name: 'Test', root, realRoot: root, allow_read: true, allow_write: allowWrite, allow_patch: false, allow_tests: false, allow_screen: false, allow_mouse_keyboard: false, api_sets: machineAdmin ? { machine_admin: true } : {}, filesystem: { machine_admin_host_scope: machineAdmin, host_root: '/' }, browser: { profiles: [] }, commands: {} };
}
