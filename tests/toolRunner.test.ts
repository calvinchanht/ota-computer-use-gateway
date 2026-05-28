import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runWorkspaceTool } from '../src/core/toolRunner.js';
import { ok } from '../src/core/result.js';
import type { Workspace } from '../src/core/workspaces.js';

describe('runWorkspaceTool', () => {
  it('writes audit entries', async () => {
    const workspace = await fixtureWorkspace();
    await runWorkspaceTool(new Map([[workspace.id, workspace]]), workspace.id, 'demo', async () => ok('done'));
    const audit = await readFile(path.join(workspace.realRoot, '.agent/audit/tool_calls.jsonl'), 'utf8');
    expect(audit).toContain('"tool":"demo"');
  });

  it('blocks tools when panic stop is active', async () => {
    const workspace = await fixtureWorkspace();
    await mkdir(path.join(workspace.realRoot, '.agent'), { recursive: true });
    await writeFile(path.join(workspace.realRoot, '.agent/PANIC_STOP'), 'stop');
    const result = await runWorkspaceTool(new Map([[workspace.id, workspace]]), workspace.id, 'read_file', async () => ok('done'));
    expect(result.content[0].text).toContain('panic stop');
  });
});

async function fixtureWorkspace(): Promise<Workspace> {
  const root = await mkdtemp(path.join(tmpdir(), 'gtp-runner-'));
  return { id: 'test', name: 'Test', root, realRoot: root, allow_read: true, allow_patch: false, allow_tests: false, allow_screen: false, allow_mouse_keyboard: false, commands: {} };
}
