import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { memoryWrite } from '../src/tools/memory.js';
import type { Workspace } from '../src/core/workspaces.js';

describe('memoryWrite', () => {
  it('rejects secret-like memory', async () => {
    const workspace = await fixtureWorkspace();
    await expect(memoryWrite(workspace, 'note', 'bad', 'GITHUB_TOKEN=abc')).rejects.toThrow('secrets');
  });
});

async function fixtureWorkspace(): Promise<Workspace> {
  const root = await mkdtemp(path.join(tmpdir(), 'gtp-memory-'));
  return { id: 'test', name: 'Test', root, realRoot: root, allow_read: true, allow_patch: false, allow_tests: false, allow_screen: false, allow_mouse_keyboard: false, commands: {} };
}
