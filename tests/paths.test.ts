import { mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveInside } from '../src/core/paths.js';
import type { AppConfig } from '../src/config/schema.js';
import type { Workspace } from '../src/core/workspaces.js';

const config: AppConfig = {
  server: { host: '127.0.0.1', port: 8765 },
  workspaces: [],
  security: { max_file_bytes: 1000, max_response_bytes: 1000, max_request_bytes: 1000, max_search_results: 10, denied_globs: [] }
};

describe('resolveInside', () => {
  it('rejects absolute paths', async () => {
    const workspace = await fixtureWorkspace();
    await expect(resolveInside(workspace, '/etc/passwd', config)).rejects.toThrow('absolute');
  });

  it('rejects symlink escapes', async () => {
    const workspace = await fixtureWorkspace();
    await symlink('/etc/passwd', path.join(workspace.realRoot, 'escape'));
    await expect(resolveInside(workspace, 'escape', config)).rejects.toThrow('outside');
  });

  it('resolves normal files', async () => {
    const workspace = await fixtureWorkspace();
    await writeFile(path.join(workspace.realRoot, 'ok.txt'), 'ok');
    await expect(resolveInside(workspace, 'ok.txt', config)).resolves.toMatchObject({ relative: 'ok.txt' });
  });
});

async function fixtureWorkspace(): Promise<Workspace> {
  const root = await mkdtemp(path.join(tmpdir(), 'gtp-mcp-'));
  await mkdir(path.join(root, 'src'), { recursive: true });
  return { id: 'test', name: 'Test', root, realRoot: root, allow_read: true, allow_patch: true, allow_tests: false, allow_screen: false, allow_mouse_keyboard: false, commands: {} };
}
