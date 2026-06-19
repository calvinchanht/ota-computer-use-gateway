import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { editFileTool, writeFileTool } from '../src/tools/files.js';
import type { AppConfig } from '../src/config/schema.js';
import type { Workspace } from '../src/core/workspaces.js';

const config: AppConfig = {
  server: { host: '127.0.0.1', port: 8765 },
  workspaces: [],
  security: { max_file_bytes: 20, max_response_bytes: 1000, max_request_bytes: 1000, max_search_results: 10, max_exec_ms: 120000 }
};

describe('writeFileTool', () => {
  it('requires write permission', async () => {
    const workspace = await fixtureWorkspace(false);
    await expect(writeFileTool(config, workspace, 'note.txt', 'hello')).rejects.toThrow('does not allow');
  });

  it('creates a new file inside the workspace', async () => {
    const workspace = await fixtureWorkspace(true);
    await writeFileTool(config, workspace, 'notes/one.txt', 'hello');
    await expect(readFile(path.join(workspace.realRoot, 'notes/one.txt'), 'utf8')).resolves.toBe('hello');
  });

  it('requires overwrite for existing files', async () => {
    const workspace = await fixtureWorkspace(true);
    await writeFile(path.join(workspace.realRoot, 'note.txt'), 'old');
    await expect(writeFileTool(config, workspace, 'note.txt', 'new')).rejects.toThrow('file exists');
  });

  it('writes secret-looking paths when workspace policy grants writes', async () => {
    const workspace = await fixtureWorkspace(true);
    await writeFileTool(config, workspace, 'secret/token.txt', 'x');
    await expect(readFile(path.join(workspace.realRoot, 'secret', 'token.txt'), 'utf8')).resolves.toBe('x');
  });

  it('edits exactly one matching text region', async () => {
    const workspace = await fixtureWorkspace(true);
    await writeFile(path.join(workspace.realRoot, 'note.txt'), 'alpha beta gamma');
    await editFileTool(config, workspace, 'note.txt', 'beta', 'BETA');
    await expect(readFile(path.join(workspace.realRoot, 'note.txt'), 'utf8')).resolves.toBe('alpha BETA gamma');
  });

  it('rejects ambiguous edits', async () => {
    const workspace = await fixtureWorkspace(true);
    await writeFile(path.join(workspace.realRoot, 'note.txt'), 'same same');
    await expect(editFileTool(config, workspace, 'note.txt', 'same', 'one')).rejects.toThrow('not unique');
  });
});

async function fixtureWorkspace(allowWrite: boolean): Promise<Workspace> {
  const root = await mkdtemp(path.join(tmpdir(), 'gtp-write-'));
  return { id: 'test', name: 'Test', root, realRoot: root, allow_read: true, allow_write: allowWrite, allow_patch: false, allow_tests: false, allow_screen: false, allow_mouse_keyboard: false, browser: { profiles: [] }, commands: {} };
}
