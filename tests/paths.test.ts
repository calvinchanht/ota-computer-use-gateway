import { mkdtemp, mkdir, realpath, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveInside } from '../src/core/paths.js';
import type { AppConfig } from '../src/config/schema.js';
import type { Workspace } from '../src/core/workspaces.js';

const config: AppConfig = {
  server: { host: '127.0.0.1', port: 8765 },
  workspaces: [],
  security: { max_file_bytes: 1000, max_response_bytes: 1000, max_request_bytes: 1000, max_search_results: 10, max_exec_ms: 120000, denied_globs: [] }
};

describe('resolveInside', () => {
  it('allows absolute paths inside the workspace', async () => {
    const workspace = await fixtureWorkspace();
    await writeFile(path.join(workspace.realRoot, 'abs.txt'), 'ok');
    await expect(resolveInside(workspace, path.join(workspace.realRoot, 'abs.txt'), config)).resolves.toMatchObject({ relative: 'abs.txt' });
  });

  it('rejects absolute paths outside the workspace', async () => {
    const workspace = await fixtureWorkspace();
    await expect(resolveInside(workspace, '/etc/passwd', config)).rejects.toThrow('outside');
  });

  it('rejects symlink escapes', async () => {
    const workspace = await fixtureWorkspace();
    await symlink('/etc/passwd', path.join(workspace.realRoot, 'escape'));
    await expect(resolveInside(workspace, 'escape', config)).rejects.toThrow('outside');
  });



  it('denies secret-like absolute paths inside a root workspace', async () => {
    const workspace = await fixtureWorkspace();
    await mkdir(path.join(workspace.realRoot, 'secrets'), { recursive: true });
    await writeFile(path.join(workspace.realRoot, 'secrets', 'api-token.txt'), 'secret');
    await expect(resolveInside(workspace, path.join(workspace.realRoot, 'secrets', 'api-token.txt'), config)).rejects.toThrow('secret');
  });

  it('resolves normal files', async () => {
    const workspace = await fixtureWorkspace();
    await writeFile(path.join(workspace.realRoot, 'ok.txt'), 'ok');
    await expect(resolveInside(workspace, 'ok.txt', config)).resolves.toMatchObject({ relative: 'ok.txt' });
  });
});

async function fixtureWorkspace(): Promise<Workspace> {
  const root = await mkdtemp(path.join(tmpdir(), 'gtp-mcp-'));
  const realRoot = await realpath(root);
  await mkdir(path.join(realRoot, 'src'), { recursive: true });
  return { id: 'test', name: 'Test', root, realRoot, allow_read: true, allow_write: false, allow_patch: true, allow_tests: false, allow_screen: false, allow_mouse_keyboard: false, browser: { profiles: [] }, commands: {} };
}
