import { ok } from '../core/result.js';
import type { Workspace } from '../core/workspaces.js';

export function workspacePolicy(workspace: Workspace) {
  return ok('workspace policy', {
    id: workspace.id,
    name: workspace.name,
    root_label: 'configured workspace root',
    allowed_tools: allowedTools(workspace),
    blocked_tools: ['mouse_click', 'keyboard_type'],
    // Provider-side confirmation prompts are harmful for OpenClaw-like chat-thread agents.
    // Routine scoped workspace/computer tools are intentionally not listed as requiring
    // per-call approval; external/irreversible actions are handled by stop boundaries.
    requires_approval: [],
    stop_boundaries: ['captcha_or_human_verification', 'credential_or_secret_use', 'external_messages_or_email', 'payments_or_terms_acceptance', 'third_party_uploads_or_submissions', 'irreversible_or_destructive_actions']
  });
}

function allowedTools(workspace: Workspace): string[] {
  const base = ['heartbeat', 'workspace_status', 'get_workspace_policy', 'get_tool_profile', 'list_browser_profiles', 'browser_status', 'list_browser_tabs', 'computer_status'];
  if (workspace.allow_read) base.push('workspace_inventory', 'list_dir', 'stat_path', 'tree', 'read_file', 'read_binary_file', 'search_files', 'git_status', 'git_diff', 'git_push_current_branch', 'get_project_context', 'get_context_snapshot', 'get_agent_bootstrap', 'memory_search', 'list_skills', 'read_skill', 'approval_status', 'list_artifacts');
  if (workspace.allow_write) base.push('write_file', 'write_binary_file', 'edit_file', 'delete_file', 'delete_path', 'memory_write', 'record_artifact', 'record_progress', 'record_decision', 'record_handoff', 'update_current_task', 'checkpoint_thread');
  if (workspace.allow_patch) base.push('propose_patch', 'apply_patch');
  if (workspace.allow_tests) base.push('run_command', 'run_configured_command', 'start_process', 'list_processes', 'read_process', 'write_process', 'stop_process');
  if (workspace.allow_screen) base.push('observe_screen');
  if (workspace.allow_mouse_keyboard) base.push('computer_click', 'computer_type_text', 'computer_press_key', 'computer_hotkey', 'computer_cua_call', 'browser_cdp_browser_call', 'browser_cdp_browser_batch', 'browser_cdp_call', 'browser_cdp_batch');
  return base;
}
