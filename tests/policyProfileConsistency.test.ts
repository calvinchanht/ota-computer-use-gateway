import { describe, expect, it } from 'vitest';
import { workspacePolicy } from '../src/tools/policy.js';
import { toolProfile } from '../src/tools/toolProfile.js';
import type { Workspace } from '../src/core/workspaces.js';

describe('policy and tool profile consistency', () => {
  it('advertises every canonical primitive when all capabilities are enabled', () => {
    const policy = workspacePolicy(fixtureWorkspace()).data;
    const profile = toolProfile().data;
    for (const tool of profile?.canonical_tools ?? []) {
      expect(policy?.allowed_tools, tool).toContain(tool);
    }
  });

  it('does not advertise deprecated aliases in workspace policy', () => {
    const policy = workspacePolicy(fixtureWorkspace()).data;
    const profile = toolProfile().data;
    for (const tool of Object.keys(profile?.deprecated_tools ?? {})) {
      expect(policy?.allowed_tools, tool).not.toContain(tool);
    }
  });
});

function fixtureWorkspace(): Workspace {
  return {
    id: 'test',
    name: 'Test',
    root: '/tmp/test',
    realRoot: '/tmp/test',
    allow_read: true,
    allow_write: true,
    allow_patch: true,
    allow_tests: true,
    allow_screen: false,
    allow_mouse_keyboard: false,
    commands: { test: 'npm test' }
  };
}
