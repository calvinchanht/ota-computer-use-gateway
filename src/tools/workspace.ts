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
    commands: Object.keys(workspace.commands).sort()
  };
}
