import { ok } from '../core/result.js';
import { commandRuntimeInfo } from '../core/commandAdapter.js';
import type { Workspace } from '../core/workspaces.js';
import type { AppConfig } from '../config/schema.js';

export function workspacePolicy(workspace: Workspace, config?: AppConfig) {
  return ok('workspace policy', {
    id: workspace.id,
    name: workspace.name,
    root_label: 'configured workspace root',
    filesystem_scope: filesystemScope(workspace),
    api_sets: resolvedApiSets(workspace),
    api_set_notes: {
      workspace: 'OpenClaw-like workspace agent primitives: scoped files, tmp cleanup/delete, artifacts, context, skills, bounded run_command/processes, git/context helpers, and async run recovery.',
      browser: 'Direct full scoped CDP access to preassigned browser profiles/ports. browser_visible_state/click/upload helpers are convenience tools only, not an observer/read-only fallback.',
      computer: 'Local GUI/computer-use via Cua Driver: screenshots, windows, accessibility tree, mouse, keyboard, and local app control.',
      computer_windows: 'Windows desktop computer-use via native APIs. The api_sets.computer_windows macro grants full Windows rights; partial lanes should set windows_computer.enabled plus individual rights.',
      machine_admin: 'Host/lane administration and configured operations such as run_configured_command, services, config, tunnels, and deployment workflows. When filesystem.machine_admin_host_scope is enabled, existing file tools may resolve explicit absolute host paths inside host_root; no host_* duplicate tools are used.',
      estate_admin: 'Cross-agent/cross-host Genesis control-plane reports/diagnostics and approved estate runbook operations.'
    },
    policy_model: {
      principle: 'Webchat agents should not be weaker than OpenClaw agents when a capability set is enabled; safety wraps powerful primitives instead of replacing them with toy actions.',
      workspace_exec: 'Bounded run_command/start_process/read_process/write_process/stop_process are normal workspace-agent primitives when workspace or allow_tests is enabled.',
      workspace_delete: 'delete_file/delete_path are normal scoped workspace editing tools, suitable for tmp cleanup and routine file management.',
      machine_admin: 'run_configured_command and service/tunnel/host administration are machine_admin. Existing file tools remain one vocabulary: workspace-only lanes stay root-scoped; machine_admin host-scope lanes may use explicit absolute host paths inside host_root. No hidden path/secret/glob deny layer exists; adding one requires Calvin approval.',
      provider_prompts: 'Provider-side confirmation prompts are intentionally minimized for routine scoped workspace/browser/computer work. OTA policy must not add generic stop-boundary lists; if the real UI blocks progress, report the concrete blocker.'
    },
    command_runtime: commandRuntimeInfo(undefined, config?.command_runtime),
    allowed_tools: allowedTools(workspace),
    windows_computer_rights: workspace.windows_computer,
    // Provider-side confirmation prompts are harmful for OpenClaw-like chat-thread agents.
    // Routine scoped workspace/browser/computer tools are intentionally not listed as blocked
    // or requiring per-call approval. Calvin policy: do not add stop_boundaries or blocked_tools
    // without Calvin's explicit approval.
    requires_approval: []
  });
}


function filesystemScope(workspace: Workspace) {
  const sets = resolvedApiSets(workspace);
  const hostScope = Boolean(sets.machine_admin && workspace.filesystem?.machine_admin_host_scope);
  return {
    default_scope: 'workspace',
    absolute_path_scope: hostScope ? 'host' : 'workspace',
    machine_admin_host_scope: hostScope,
    host_root: hostScope ? (workspace.filesystem?.host_root ?? '/') : undefined,
    note: hostScope
      ? 'Existing file tools may access explicit absolute host paths inside host_root. Relative paths remain resolved from the configured workspace root.'
      : 'Existing file tools are scoped to the configured workspace root; absolute paths outside that root are denied.'
  };
}

export function resolvedApiSets(workspace: Workspace) {
  const configured = workspace.api_sets ?? {};
  const hasConfiguredSets = Object.keys(configured).length > 0;
  return {
    workspace: configured.workspace ?? (workspace.allow_read || workspace.allow_write || workspace.allow_patch || workspace.allow_tests),
    browser: configured.browser ?? workspace.allow_mouse_keyboard,
    // Backward-compatible inference: old configs used allow_screen/allow_mouse_keyboard for both
    // browser and computer capability. New api_sets configs can distinguish browser from Cua/computer use.
    computer: configured.computer ?? (!hasConfiguredSets && (workspace.allow_screen || workspace.allow_mouse_keyboard)),
    computer_windows: configured.computer_windows ?? workspace.windows_computer?.enabled ?? false,
    machine_admin: configured.machine_admin ?? false,
    estate_admin: configured.estate_admin ?? false
  };
}

export function allowedTools(workspace: Workspace): string[] {
  const sets = resolvedApiSets(workspace);
  const base = ['heartbeat', 'workspace_status', 'get_workspace_policy', 'get_tool_profile'];

  if (sets.estate_admin) base.push('genesis_bootstrap', 'genesis_estate_overview', 'genesis_agent_deep_dive', 'genesis_host_deep_dive', 'genesis_safe_diagnostic');


  if (sets.workspace || workspace.allow_read) base.push('workspace_inventory', 'list_dir', 'stat_path', 'tree', 'read_file', 'read_file_chunk', 'read_file_lines', 'read_binary_file', 'infer_file_structure', 'sample_file', 'read_around', 'search_file', 'search_files', 'table_profile', 'query_table', 'query_table_aggregate', 'json_profile', 'query_json', 'git_status', 'git_diff', 'git_push_current_branch', 'get_project_context', 'get_context_snapshot', 'get_agent_bootstrap', 'memory_search', 'list_skills', 'read_skill', 'approval_status', 'list_artifacts');
  if (sets.workspace || workspace.allow_write) base.push('write_file', 'write_binary_file', 'edit_file', 'delete_file', 'delete_path', 'update_table_rows', 'memory_write', 'record_artifact', 'record_progress', 'record_decision', 'record_handoff', 'update_current_task', 'checkpoint_thread');
  if (sets.workspace || workspace.allow_patch) base.push('propose_patch', 'apply_patch', 'patch_file_lines');
  if (sets.workspace || workspace.allow_tests) base.push('run_command', 'start_process', 'list_processes', 'read_process', 'write_process', 'stop_process');

  if (sets.browser) base.push('list_browser_profiles', 'browser_status', 'list_browser_tabs', 'browser_visible_state', 'browser_tail', 'browser_manage_tabs', 'browser_click_and_wait', 'browser_upload_file_and_verify', 'browser_cdp_browser_call', 'browser_cdp_browser_batch', 'browser_cdp_call', 'browser_cdp_batch');
  if (sets.computer) base.push('cua_driver_status', 'computer_screen_click', 'computer_window_click', 'computer_screen_mouse_move', 'computer_window_mouse_move', 'computer_screen_drag', 'computer_window_drag', 'computer_screen_scroll', 'computer_window_scroll', 'cua_driver_call', 'cua_driver_batch');
  if (sets.computer_windows) base.push(...windowsComputerTools(workspace));
  if (sets.machine_admin) base.push('run_configured_command');

  return [...new Set(base)];
}

function windowsComputerTools(workspace: Workspace) {
  const config = workspace.windows_computer;
  const tools = ['windows_computer_status', 'windows_list_monitors'];
  if (config?.allow_screenshot) tools.push('windows_screenshot');
  if (config?.allow_uia_tree) tools.push('windows_uia_tree');
  if (config?.allow_window_management) tools.push('windows_list_windows', 'windows_focus_window');
  if (config?.allow_app_launch) tools.push('windows_launch_app');
  if (config?.allow_mouse) tools.push('windows_mouse_move', 'windows_click', 'windows_double_click', 'windows_drag', 'windows_scroll');
  if (config?.allow_mouse && config?.allow_window_management) tools.push('windows_window_mouse_move', 'windows_window_click', 'windows_window_double_click', 'windows_window_drag', 'windows_window_scroll');
  if (config?.allow_keyboard) tools.push('windows_type_text', 'windows_key', 'windows_hotkey');
  if (config?.allow_clipboard) tools.push('windows_clipboard_get', 'windows_clipboard_set');
  if (config?.allow_mouse || config?.allow_keyboard) tools.push('windows_batch');
  return tools;
}
