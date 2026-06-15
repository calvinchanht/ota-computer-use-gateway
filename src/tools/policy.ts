import { ok } from '../core/result.js';
import type { Workspace } from '../core/workspaces.js';

export function workspacePolicy(workspace: Workspace) {
  return ok('workspace policy', {
    id: workspace.id,
    name: workspace.name,
    root_label: 'configured workspace root',
    api_sets: resolvedApiSets(workspace),
    api_set_notes: {
      workspace: 'OpenClaw-like workspace agent primitives: scoped files, tmp cleanup/delete, artifacts, context, skills, bounded run_command/processes, git/context helpers, and async run recovery.',
      browser: 'Preassigned browser profiles/ports plus CDP-backed tabs, visible state, click/wait, and upload verification.',
      computer: 'Local GUI/computer-use via Cua Driver: screenshots, windows, accessibility tree, mouse, keyboard, and local app control.',
      computer_windows: 'Windows desktop computer-use via native APIs. The api_sets.computer_windows macro grants full Windows rights; partial lanes should set windows_computer.enabled plus individual rights.',
      machine_admin: 'Host/lane administration and configured operations such as run_configured_command, services, config, tunnels, and deployment workflows. This is separate from normal workspace exec.',
      estate_admin: 'Cross-agent/cross-host Genesis control-plane reports/diagnostics and approved estate runbook operations.'
    },
    policy_model: {
      principle: 'Webchat agents should not be weaker than OpenClaw agents when a capability set is enabled; safety wraps powerful primitives instead of replacing them with toy actions.',
      workspace_exec: 'Bounded run_command/start_process/read_process/write_process/stop_process are normal workspace-agent primitives when workspace or allow_tests is enabled.',
      workspace_delete: 'delete_file/delete_path are normal scoped workspace editing tools, suitable for tmp cleanup and routine file management. Irreversible or out-of-scope destructive workflows remain stop-boundary events.',
      machine_admin: 'run_configured_command and service/tunnel/host administration are machine_admin, not ordinary workspace execution.',
      provider_prompts: 'Provider-side confirmation prompts are intentionally minimized for routine scoped workspace/browser/computer work; stop boundaries describe when the agent must pause for Calvin.'
    },
    allowed_tools: allowedTools(workspace),
    windows_computer_rights: workspace.windows_computer,
    blocked_tools: ['mouse_click', 'keyboard_type'],
    // Provider-side confirmation prompts are harmful for OpenClaw-like chat-thread agents.
    // Routine scoped workspace/computer tools are intentionally not listed as requiring
    // per-call approval; external/irreversible actions are handled by stop boundaries.
    requires_approval: [],
    stop_boundaries: ['captcha_or_human_verification', 'credential_or_secret_use_or_secret_exfiltration', 'external_messages_email_chat_or_public_posts', 'third_party_uploads_or_form_submissions', 'payments_purchases_or_terms_acceptance', 'account_security_settings_or_identity_verification', 'irreversible_or_out_of_scope_destructive_actions']
  });
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

  if (sets.workspace || workspace.allow_read) base.push('workspace_inventory', 'list_dir', 'stat_path', 'tree', 'read_file', 'read_binary_file', 'search_files', 'git_status', 'git_diff', 'git_push_current_branch', 'get_project_context', 'get_context_snapshot', 'get_agent_bootstrap', 'memory_search', 'list_skills', 'read_skill', 'approval_status', 'list_artifacts');
  if (sets.workspace || workspace.allow_write) base.push('write_file', 'write_binary_file', 'edit_file', 'delete_file', 'delete_path', 'memory_write', 'record_artifact', 'record_progress', 'record_decision', 'record_handoff', 'update_current_task', 'checkpoint_thread');
  if (sets.workspace || workspace.allow_patch) base.push('propose_patch', 'apply_patch');
  if (sets.workspace || workspace.allow_tests) base.push('run_command', 'start_process', 'list_processes', 'read_process', 'write_process', 'stop_process');

  if (sets.browser) base.push('list_browser_profiles', 'browser_status', 'list_browser_tabs', 'browser_visible_state', 'browser_tail', 'browser_manage_tabs', 'browser_click_and_wait', 'browser_upload_file_and_verify', 'browser_cdp_browser_call', 'browser_cdp_browser_batch', 'browser_cdp_call', 'browser_cdp_batch');
  if (sets.computer) base.push('cua_driver_status', 'computer_screen_click', 'computer_window_click', 'cua_driver_call', 'cua_driver_batch');
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
  if (config?.allow_mouse) tools.push('windows_click', 'windows_double_click', 'windows_drag', 'windows_scroll');
  if (config?.allow_keyboard) tools.push('windows_type_text', 'windows_key', 'windows_hotkey');
  if (config?.allow_clipboard) tools.push('windows_clipboard_get', 'windows_clipboard_set');
  if (config?.allow_mouse || config?.allow_keyboard) tools.push('windows_batch');
  return tools;
}
