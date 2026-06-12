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

  it('documents OpenClaw-strength workspace primitives without treating delete or exec as machine admin', () => {
    const policy = workspacePolicy(fixtureWorkspace()).data;
    expect(policy?.policy_model?.principle).toContain('not be weaker than OpenClaw');
    expect(policy?.policy_model?.workspace_exec).toContain('run_command');
    expect(policy?.policy_model?.workspace_delete).toContain('delete_file');
    expect(policy?.policy_model?.workspace_delete).toContain('normal scoped workspace editing');
    expect(policy?.policy_model?.machine_admin).toContain('run_configured_command');
    expect(policy?.allowed_tools).toContain('delete_file');
    expect(policy?.allowed_tools).toContain('run_command');
    expect(policy?.allowed_tools).toContain('run_configured_command');
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
    allow_screen: true,
    allow_mouse_keyboard: true,
    api_sets: { workspace: true, browser: true, computer: true, machine_admin: true, estate_admin: true },
    browser: { profiles: [] },
    commands: { test: 'npm test' }
  };
}
