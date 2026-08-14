import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { memoryWrite } from '../src/tools/memory.js';
import type { Workspace } from '../src/core/workspaces.js';

describe('memoryWrite', () => {
  it('allows secret-like terminology by default', async () => {
    const workspace = await fixtureWorkspace();
    await expect(memoryWrite(workspace, 'note', 'compat', 'GITHUB_TOKEN=placeholder')).resolves.toBeTruthy();
  });

  it('restores secret-like content rejection when conservative censoring is enabled', async () => {
    const workspace = await fixtureWorkspace();
    await expect(memoryWrite(workspace, 'note', 'bad', 'GITHUB_TOKEN=abc', [], true)).rejects.toThrow('secrets');
  });
});

async function fixtureWorkspace(): Promise<Workspace> {
  const root = await mkdtemp(path.join(tmpdir(), 'gtp-memory-'));
  return { id: 'test', name: 'Test', root, realRoot: root, allow_read: true, allow_write: false, allow_patch: false, allow_tests: false, allow_screen: false, allow_mouse_keyboard: false, browser: { profiles: [] }, commands: {} };
}
