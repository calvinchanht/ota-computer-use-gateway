import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { hasApproval, recordApproval } from '../src/core/approval.js';
import type { Workspace } from '../src/core/workspaces.js';

describe('approval store', () => {
  it('records active approvals', async () => {
    const workspace = await fixtureWorkspace();
    await recordApproval(workspace, { id: 'a1', action: 'apply_patch', created_at: new Date().toISOString() });
    await expect(hasApproval(workspace, 'apply_patch')).resolves.toBe(true);
  });

  it('ignores expired approvals', async () => {
    const workspace = await fixtureWorkspace();
    await recordApproval(workspace, { id: 'a1', action: 'apply_patch', created_at: new Date().toISOString(), expires_at: '2000-01-01T00:00:00Z' });
    await expect(hasApproval(workspace, 'apply_patch')).resolves.toBe(false);
  });
});

async function fixtureWorkspace(): Promise<Workspace> {
  const root = await mkdtemp(path.join(tmpdir(), 'gtp-approval-'));
  return { id: 'test', name: 'Test', root, realRoot: root, allow_read: true, allow_write: false, allow_patch: true, allow_tests: false, allow_screen: false, allow_mouse_keyboard: false, browser: { profiles: [] }, commands: {} };
}
