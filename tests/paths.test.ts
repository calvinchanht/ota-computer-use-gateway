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

  it('rejects absolute paths outside the workspace for workspace-only agents', async () => {
    const workspace = await fixtureWorkspace();
    const outside = await outsideFile();
    await expect(resolveInside(workspace, outside, config)).rejects.toThrow('workspace-relative');
  });

  it('allows machine_admin host-scope absolute paths outside the workspace', async () => {
    const outside = await outsideFile();
    const workspace = await fixtureWorkspace(false, true, path.parse(outside).root);
    await expect(resolveInside(workspace, outside, config)).resolves.toMatchObject({ absolute: outside, displayPath: outside.replaceAll('\\', '/'), scope: 'host' });
  });


  it('applies configured absolute denied globs to host-scope machine_admin reads', async () => {
    const outside = await outsideFile('blocked-token.txt');
    const workspace = await fixtureWorkspace(false, true, path.parse(outside).root);
    const denyConfig = { ...config, security: { ...config.security, denied_globs: [outside.replace(/blocked-token\.txt$/, '*-token.txt')] } };
    await expect(resolveInside(workspace, outside, denyConfig)).rejects.toThrow('denied by configured glob');
  });

  it('keeps relative escapes blocked even when machine_admin host scope is enabled', async () => {
    const workspace = await fixtureWorkspace(false, true);
    await expect(resolveInside(workspace, '../outside.txt', config)).rejects.toThrow('workspace-relative');
  });


  it('rejects relative parent segments even when the workspace root is filesystem root', async () => {
    const workspace = await fixtureRootWorkspace(true);
    await expect(resolveInside(workspace, '../etc/hostname', config)).rejects.toThrow('workspace-relative');
    await expect(resolveInside(workspace, 'tmp/../etc/hostname', config)).rejects.toThrow('workspace-relative');
  });

  it('rejects relative path escapes with corrective guidance', async () => {
    const workspace = await fixtureWorkspace();
    await expect(resolveInside(workspace, '../outside.txt', config)).rejects.toThrow('workspace-relative');
  });

  it('rejects symlink escapes', async () => {
    const workspace = await fixtureWorkspace();
    const outsideRoot = await mkdtemp(path.join(tmpdir(), 'gtp-outside-'));
    await writeFile(path.join(outsideRoot, 'outside.txt'), 'outside');
    await symlink(outsideRoot, path.join(workspace.realRoot, 'escape'), 'junction');
    await expect(resolveInside(workspace, path.join('escape', 'outside.txt'), config)).rejects.toThrow('workspace-relative');
  });



  it('allows secret-like absolute paths inside a root workspace', async () => {
    const workspace = await fixtureWorkspace();
    await mkdir(path.join(workspace.realRoot, 'secrets'), { recursive: true });
    await writeFile(path.join(workspace.realRoot, 'secrets', 'api-token.txt'), 'secret');
    await expect(resolveInside(workspace, path.join(workspace.realRoot, 'secrets', 'api-token.txt'), config)).resolves.toMatchObject({ relative: 'secrets/api-token.txt' });
  });

  it('resolves normal files', async () => {
    const workspace = await fixtureWorkspace();
    await writeFile(path.join(workspace.realRoot, 'ok.txt'), 'ok');
    await expect(resolveInside(workspace, 'ok.txt', config)).resolves.toMatchObject({ relative: 'ok.txt' });
  });
});

async function fixtureWorkspace(allowWrite = false, machineAdmin = false, hostRoot = '/'): Promise<Workspace> {
  const root = await mkdtemp(path.join(tmpdir(), 'gtp-mcp-'));
  const realRoot = await realpath(root);
  await mkdir(path.join(realRoot, 'src'), { recursive: true });
  return { id: 'test', name: 'Test', root, realRoot, allow_read: true, allow_write: allowWrite, allow_patch: true, allow_tests: false, allow_screen: false, allow_mouse_keyboard: false, api_sets: machineAdmin ? { machine_admin: true } : {}, filesystem: { machine_admin_host_scope: machineAdmin, host_root: hostRoot }, browser: { profiles: [] }, commands: {} };
}


async function fixtureRootWorkspace(machineAdmin = false): Promise<Workspace> {
  return { id: 'root-test', name: 'Root Test', root: '/', realRoot: '/', allow_read: true, allow_write: false, allow_patch: true, allow_tests: false, allow_screen: false, allow_mouse_keyboard: false, api_sets: machineAdmin ? { machine_admin: true } : {}, filesystem: { machine_admin_host_scope: machineAdmin, host_root: '/' }, browser: { profiles: [] }, commands: {} };
}

async function outsideFile(name = 'outside.txt'): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'gtp-outside-'));
  const file = path.join(root, name);
  await writeFile(file, 'outside');
  return file;
}
