import { ok } from '../core/result.js';
import type { Workspace } from '../core/workspaces.js';

export function workspacePolicy(workspace: Workspace) {
  return ok('workspace policy', {
    id: workspace.id,
    name: workspace.name,
    root_label: 'configured workspace root',
    api_sets: resolvedApiSets(workspace),
    api_set_notes: {
      workspace: 'Scoped workspace files, artifacts, context, skills, and async run recovery. Command/process tools require allow_tests or machine_admin.',
      browser: 'Preassigned browser profiles/ports plus CDP-backed tabs, visible state, click/wait, and upload verification.',
      computer: 'Local GUI/computer-use via Cua Driver: screenshots, windows, accessibility tree, mouse, keyboard, and local app control.',
      machine_admin: 'Own machine/lane management through configured commands/process tools; service/config/tunnel work must stay scoped to the assigned machine.',
      estate_admin: 'Cross-agent/cross-host Genesis control-plane reports/diagnostics and approved estate runbook operations.'
    },
    allowed_tools: allowedTools(workspace),
    blocked_tools: ['mouse_click', 'keyboard_type'],
    // Provider-side confirmation prompts are harmful for OpenClaw-like chat-thread agents.
    // Routine scoped workspace/computer tools are intentionally not listed as requiring
    // per-call approval; external/irreversible actions are handled by stop boundaries.
    requires_approval: [],
    stop_boundaries: ['captcha_or_human_verification', 'credential_or_secret_use', 'external_messages_or_email', 'payments_or_terms_acceptance', 'third_party_uploads_or_submissions', 'irreversible_or_destructive_actions']
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
  if (sets.machine_admin || workspace.allow_tests) base.push('run_command', 'start_process', 'list_processes', 'read_process', 'write_process', 'stop_process');

  if (sets.browser) base.push('list_browser_profiles', 'browser_status', 'list_browser_tabs', 'browser_visible_state', 'browser_manage_tabs', 'browser_click_and_wait', 'browser_upload_file_and_verify', 'browser_cdp_browser_call', 'browser_cdp_browser_batch', 'browser_cdp_call', 'browser_cdp_batch');
  if (sets.computer) base.push('cua_driver_status', 'cua_driver_call', 'cua_driver_batch');
  if (sets.machine_admin) base.push('run_configured_command');

  return [...new Set(base)];
}
