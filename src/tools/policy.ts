import { ok } from '../core/result.js';
import type { Workspace } from '../core/workspaces.js';

export function workspacePolicy(workspace: Workspace) {
  return ok('workspace policy', {
    id: workspace.id,
    name: workspace.name,
    root_label: 'configured workspace root',
    allowed_tools: allowedTools(workspace),
    blocked_tools: ['delete_file', 'mouse_click', 'keyboard_type'],
    requires_approval: ['apply_patch', 'run_command', 'exec', 'capture_screen']
  });
}

function allowedTools(workspace: Workspace): string[] {
  const base = ['heartbeat', 'workspace_status', 'get_workspace_policy'];
  if (workspace.allow_read) base.push('list_dir', 'read_file', 'search_files', 'git_status', 'git_diff');
  if (workspace.allow_write) base.push('write_file');
  if (workspace.allow_patch) base.push('propose_patch', 'apply_patch');
  if (workspace.allow_tests) base.push('run_command', 'exec');
  return base;
}
