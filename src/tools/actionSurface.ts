import { ESTATE_TOOL_NAMES } from './genesis.js';
import { OTA_MEMORY_TOOL_NAMES } from './otaMemory.js';

export const BASE_TOOL_NAMES = [
  'heartbeat', 'workspace_status', 'get_workspace_policy', 'get_tool_profile'
] as const;

export const WORKSPACE_READ_TOOL_NAMES = [
  'workspace_inventory', 'list_dir', 'stat_path', 'tree', 'read_file', 'read_file_chunk', 'read_file_lines',
  'read_binary_file', 'infer_file_structure', 'sample_file', 'read_around', 'search_file', 'search_files',
  'table_profile', 'query_table', 'query_table_aggregate', 'json_profile', 'query_json', 'git_status', 'git_diff',
  'git_push_current_branch', 'git_lfs_publish_current_branch', 'get_project_context', 'get_context_snapshot',
  'get_agent_bootstrap', 'list_skills', 'read_skill', 'approval_status', 'list_artifacts'
] as const;

export const WORKSPACE_WRITE_TOOL_NAMES = [
  'write_file', 'write_binary_file', 'edit_file', 'delete_file', 'delete_path', 'update_table_rows', 'record_artifact',
  'record_progress', 'record_decision', 'record_handoff', 'update_current_task', 'checkpoint_thread'
] as const;

export const WORKSPACE_PATCH_TOOL_NAMES = ['propose_patch', 'apply_patch', 'patch_file_lines'] as const;

export const WORKSPACE_EXEC_TOOL_NAMES = [
  'run_command', 'git', 'github', 'start_process', 'list_processes', 'read_process', 'write_process', 'stop_process'
] as const;

export const BROWSER_TOOL_NAMES = [
  'list_browser_profiles', 'browser_status', 'list_browser_tabs', 'browser_visible_state', 'browser_tail',
  'browser_manage_tabs', 'browser_click_and_wait', 'browser_upload_file_and_verify', 'browser_cdp_browser_call',
  'browser_cdp_browser_batch', 'browser_cdp_call', 'browser_cdp_batch'
] as const;

export const MAC_COMPUTER_TOOL_NAMES = [
  'cua_driver_status', 'computer_screen_click', 'computer_window_click', 'computer_screen_mouse_move',
  'computer_window_mouse_move', 'computer_screen_drag', 'computer_window_drag', 'computer_screen_scroll',
  'computer_window_scroll', 'cua_driver_call', 'cua_driver_batch'
] as const;

export const WINDOWS_COMPUTER_TOOL_NAMES = [
  'windows_computer_status', 'windows_list_monitors', 'windows_screenshot', 'windows_window_screenshot',
  'windows_window_screenshot_sequence', 'windows_uia_tree', 'windows_uia_read', 'windows_uia_set_value',
  'windows_list_windows', 'windows_focus_window', 'windows_place_window', 'windows_launch_app',
  'windows_mouse_move', 'windows_click', 'windows_double_click', 'windows_drag', 'windows_scroll',
  'windows_window_mouse_move', 'windows_window_click', 'windows_window_double_click', 'windows_window_drag',
  'windows_window_scroll', 'windows_type_text', 'windows_key', 'windows_hotkey', 'windows_clipboard_get',
  'windows_clipboard_set', 'windows_batch'
] as const;

export const MACHINE_ADMIN_TOOL_NAMES = [
  'run_configured_command', 'workspace_helper_list', 'workspace_helper_status', 'workspace_helper_upsert', 'workspace_helper_run'
] as const;

export const LEGACY_MEMORY_TOOL_NAMES = ['memory_search', 'memory_write'] as const;
export const MEMORY_LIFECYCLE_TOOL_NAMES = [...OTA_MEMORY_TOOL_NAMES] as const;
export const ALWAYS_EXPOSED_PROVIDER_TOOL_NAMES = [...MEMORY_LIFECYCLE_TOOL_NAMES] as const;
export const ESTATE_ADMIN_TOOL_NAMES = [...ESTATE_TOOL_NAMES] as const;

export const WORKSPACE_TOOL_NAMES = unique([
  ...WORKSPACE_READ_TOOL_NAMES, ...WORKSPACE_WRITE_TOOL_NAMES, ...WORKSPACE_PATCH_TOOL_NAMES, ...WORKSPACE_EXEC_TOOL_NAMES
]);

export const CANONICAL_PROVIDER_TOOL_NAMES = unique([
  ...BASE_TOOL_NAMES, ...WORKSPACE_TOOL_NAMES, ...BROWSER_TOOL_NAMES, ...MAC_COMPUTER_TOOL_NAMES,
  ...WINDOWS_COMPUTER_TOOL_NAMES, ...MACHINE_ADMIN_TOOL_NAMES, ...ESTATE_ADMIN_TOOL_NAMES,
  ...MEMORY_LIFECYCLE_TOOL_NAMES, ...LEGACY_MEMORY_TOOL_NAMES
]);

export function capabilityToolGroups() {
  return {
    workspace: [...WORKSPACE_TOOL_NAMES],
    browser: [...BROWSER_TOOL_NAMES],
    computer: [...MAC_COMPUTER_TOOL_NAMES],
    computer_windows: [...WINDOWS_COMPUTER_TOOL_NAMES],
    machine_admin: [...MACHINE_ADMIN_TOOL_NAMES, ...WORKSPACE_EXEC_TOOL_NAMES],
    estate_admin: [...ESTATE_ADMIN_TOOL_NAMES],
    memory_lifecycle: [...MEMORY_LIFECYCLE_TOOL_NAMES]
  };
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}
