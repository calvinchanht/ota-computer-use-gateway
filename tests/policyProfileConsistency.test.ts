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



  it('exposes filesystem scope for machine_admin and workspace-only lanes', () => {
    const machinePolicy = workspacePolicy(fixtureWorkspace()).data;
    expect(machinePolicy?.filesystem_scope).toMatchObject({
      default_scope: 'workspace',
      absolute_path_scope: 'host',
      machine_admin_host_scope: true,
      host_root: '/'
    });
    expect(machinePolicy?.policy_model?.machine_admin).toContain('Existing file tools remain one vocabulary');

    const workspaceOnly = workspacePolicy(fixtureWorkspace({
      api_sets: { workspace: true, browser: false, computer: false, computer_windows: false, machine_admin: false, estate_admin: false },
      filesystem: { machine_admin_host_scope: false, host_root: '/' }
    })).data;
    expect(workspaceOnly?.filesystem_scope).toMatchObject({
      default_scope: 'workspace',
      absolute_path_scope: 'workspace',
      machine_admin_host_scope: false
    });
    expect(workspaceOnly?.filesystem_scope?.host_root).toBeUndefined();
  });

  it('exposes implemented data and patch helpers through the workspace policy', () => {
    const policy = workspacePolicy(fixtureWorkspace()).data;
    expect(policy?.allowed_tools).toEqual(expect.arrayContaining([
      'infer_file_structure', 'sample_file', 'read_around', 'search_file',
      'table_profile', 'query_table', 'query_table_aggregate', 'json_profile', 'query_json',
      'patch_file_lines', 'update_table_rows'
    ]));
  });

  it('advertises only enabled Windows computer-use rights for partial Windows lanes', () => {
    const policy = workspacePolicy(fixtureWorkspace({
      api_sets: {},
      windows_computer: {
        enabled: true,
        allow_screenshot: false,
        allow_uia_tree: true,
        allow_mouse: false,
        allow_keyboard: false,
        allow_clipboard: false,
        allow_window_management: true,
        allow_app_launch: true,
        allow_process_attach: false,
        allow_multi_monitor: true
      }
    })).data;

    expect(policy?.allowed_tools).toContain('windows_computer_status');
    expect(policy?.allowed_tools).toContain('windows_list_monitors');
    expect(policy?.allowed_tools).toContain('windows_uia_tree');
    expect(policy?.allowed_tools).toContain('windows_list_windows');
    expect(policy?.allowed_tools).toContain('windows_launch_app');
    expect(policy?.allowed_tools).not.toContain('windows_screenshot');
    expect(policy?.allowed_tools).not.toContain('windows_click');
    expect(policy?.allowed_tools).not.toContain('windows_type_text');
    expect(policy?.allowed_tools).not.toContain('windows_clipboard_get');
  });

  it('explains full Windows macro versus partial Windows rights', () => {
    const policy = workspacePolicy(fixtureWorkspace()).data;
    const profile = toolProfile().data;
    const windowsSet = profile?.api_capability_sets?.sets?.computer_windows;

    expect(policy?.api_set_notes?.computer_windows).toContain('macro grants full Windows rights');
    expect(policy?.windows_computer_rights?.enabled).toBe(true);
    expect(windowsSet?.full_macro).toContain('complete Windows computer-use surface');
    expect(windowsSet?.partial_rights).toContain('individual allow_* rights');
  });

});

function fixtureWorkspace(overrides: Partial<Workspace> = {}): Workspace {
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
    api_sets: { workspace: true, browser: true, computer: true, computer_windows: true, machine_admin: true, estate_admin: true },
    windows_computer: {
      enabled: true,
      allow_screenshot: true,
      allow_uia_tree: true,
      allow_mouse: true,
      allow_keyboard: true,
      allow_clipboard: true,
      allow_window_management: true,
      allow_app_launch: true,
      allow_process_attach: true,
      allow_multi_monitor: true
    },
    browser: { profiles: [] },
    commands: { test: 'npm test' },
    filesystem: { machine_admin_host_scope: true, host_root: '/' },
    ...overrides
  };
}
