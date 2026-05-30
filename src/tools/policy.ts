import { ok } from '../core/result.js';
import type { Workspace } from '../core/workspaces.js';

export function workspacePolicy(workspace: Workspace) {
  return ok('workspace policy', {
    id: workspace.id,
    name: workspace.name,
    root_label: 'configured workspace root',
    allowed_tools: allowedTools(workspace),
    blocked_tools: ['delete_file', 'mouse_click', 'keyboard_type'],
    requires_approval: ['apply_patch', 'run_command', 'start_process', 'capture_screen']
  });
}

function allowedTools(workspace: Workspace): string[] {
  const base = ['heartbeat', 'workspace_status', 'get_workspace_policy', 'get_tool_profile', 'list_browser_profiles', 'browser_status', 'list_browser_tabs', 'browser_tab_info', 'computer_status'];
  if (workspace.allow_read) base.push('list_dir', 'stat_path', 'tree', 'read_file', 'read_binary_file', 'search_files', 'git_status', 'git_diff', 'get_project_context', 'get_context_snapshot', 'get_agent_bootstrap', 'memory_search', 'list_skills', 'read_skill', 'approval_status', 'list_artifacts');
  if (workspace.allow_write) base.push('write_file', 'write_binary_file', 'edit_file', 'memory_write', 'record_artifact', 'record_progress', 'record_decision', 'record_handoff', 'update_current_task', 'checkpoint_thread');
  if (workspace.allow_patch) base.push('propose_patch', 'apply_patch');
  if (workspace.allow_tests) base.push('run_command', 'run_configured_command', 'start_process', 'list_processes', 'read_process', 'write_process', 'stop_process');
  if (workspace.allow_screen) base.push('observe_screen', 'browser_tab_screenshot', 'browser_tab_snapshot');
  if (workspace.allow_mouse_keyboard) base.push('open_browser_tab', 'navigate_browser_tab', 'click_browser_tab', 'type_browser_tab', 'fill_browser_tab_field', 'select_browser_tab_option', 'submit_browser_tab_form', 'press_browser_tab_key', 'scroll_browser_tab', 'browser_cdp_browser_call', 'browser_cdp_browser_batch', 'browser_cdp_call', 'browser_cdp_batch', 'activate_browser_tab', 'close_browser_tab');
  return base;
}
