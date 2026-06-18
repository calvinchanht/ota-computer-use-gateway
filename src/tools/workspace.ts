import { ok } from '../core/result.js';
import type { Workspace } from '../core/workspaces.js';

export function workspaceStatus(workspaces: Map<string, Workspace>) {
  const items = [...workspaces.values()].map(describeWorkspace);
  return ok('workspace status', { workspaces: items });
}

function describeWorkspace(workspace: Workspace) {
  return {
    id: workspace.id,
    name: workspace.name,
    root: workspace.root,
    capabilities: {
      read: workspace.allow_read,
      write: workspace.allow_write,
      patch: workspace.allow_patch,
      exec: workspace.allow_tests,
      screen: workspace.allow_screen,
      mouse_keyboard: workspace.allow_mouse_keyboard
    },
    filesystem_scope: {
      absolute_path_scope: workspace.api_sets?.machine_admin && workspace.filesystem?.machine_admin_host_scope ? 'host' : 'workspace',
      machine_admin_host_scope: Boolean(workspace.api_sets?.machine_admin && workspace.filesystem?.machine_admin_host_scope),
      host_root: workspace.api_sets?.machine_admin && workspace.filesystem?.machine_admin_host_scope ? (workspace.filesystem?.host_root ?? '/') : undefined
    },
    commands: Object.keys(workspace.commands).sort()
  };
}
