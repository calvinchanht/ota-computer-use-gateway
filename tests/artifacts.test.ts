import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Workspace } from '../src/core/workspaces.js';
import { listArtifacts, recordArtifact } from '../src/tools/artifacts.js';

describe('artifact tools', () => {
  it('records and lists workspace artifact references', async () => {
    const workspace = await fixtureWorkspace();
    const recorded = (await recordArtifact(workspace, 'reports/summary.md', 'Summary', 'markdown', 'Useful output')).data as any;
    const listed = (await listArtifacts(workspace)).data as any;
    expect(recorded.artifact.path).toBe('reports/summary.md');
    expect(listed.artifacts[0].title).toBe('Summary');
  });

  it('rejects paths outside the workspace', async () => {
    const workspace = await fixtureWorkspace();
    await expect(recordArtifact(workspace, '../secret.txt', 'Bad')).rejects.toThrow('inside the workspace');
    await expect(recordArtifact(workspace, '/tmp/secret.txt', 'Bad')).rejects.toThrow('workspace-relative');
  });
});

async function fixtureWorkspace(): Promise<Workspace> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ota-artifacts-'));
  return { id: 'test', name: 'Test', root, realRoot: root, allow_read: true, allow_write: true, allow_patch: true, allow_tests: true, allow_screen: true, allow_mouse_keyboard: true, browser: { profiles: [] }, commands: {} };
}
