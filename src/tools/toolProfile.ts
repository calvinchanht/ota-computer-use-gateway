import { ok } from '../core/result.js';

export function toolProfile() {
  return ok('tool profile', {
    profile: 'api_explicit',
    naming: 'descriptive snake_case canonical tool names',
    canonical_tools: canonicalTools(),
    api_capability_sets: apiCapabilitySets(),
    api_behavior: apiBehavior(),
    tool_async: toolAsync(),
    aliases: aliases(),
    deprecated_tools: deprecatedTools(),
    skill_layouts: ['.agents/skills/<skill>/SKILL.md', '.agent/skills/<skill>/SKILL.md'],
    project_instructions: ['AGENTS.md', 'AGENTS.override.md']
  });
}

function canonicalTools(): string[] {
  return [
    'genesis_bootstrap', 'genesis_estate_overview', 'genesis_agent_deep_dive', 'genesis_host_deep_dive', 'genesis_safe_diagnostic',
    'list_browser_profiles', 'browser_status', 'list_browser_tabs', 'browser_visible_state', 'browser_tail', 'browser_manage_tabs', 'browser_click_and_wait', 'browser_upload_file_and_verify',
    'browser_cdp_browser_call', 'browser_cdp_browser_batch', 'browser_cdp_call', 'browser_cdp_batch',
    'cua_driver_status', 'cua_driver_call', 'cua_driver_batch',
    'windows_computer_status', 'windows_list_monitors', 'windows_screenshot', 'windows_uia_tree',
    'windows_list_windows', 'windows_focus_window', 'windows_launch_app',
    'windows_click', 'windows_double_click', 'windows_drag', 'windows_scroll',
    'windows_type_text', 'windows_key', 'windows_hotkey',
    'windows_clipboard_get', 'windows_clipboard_set', 'windows_batch',
    'workspace_inventory', 'read_file', 'write_file', 'read_binary_file', 'write_binary_file', 'edit_file', 'apply_patch',
    'run_command', 'run_configured_command', 'list_dir', 'stat_path', 'tree', 'search_files',
    'git_status', 'git_diff', 'git_push_current_branch', 'start_process', 'list_processes', 'read_process', 'write_process', 'stop_process',
    'get_project_context', 'get_context_snapshot', 'get_agent_bootstrap', 'memory_search', 'memory_write',
    'list_skills', 'read_skill', 'approval_status', 'list_artifacts', 'record_artifact',
    'record_progress', 'record_decision', 'record_handoff', 'update_current_task', 'checkpoint_thread'
  ];
}

function apiCapabilitySets() {
  return {
    model: 'composable_api_sets_not_linear_levels',
    config_key: 'workspaces[].api_sets',
    sets: {
      workspace: {
        purpose: 'Normal agent workspace operations.',
        tools: ['workspace_inventory', 'list_dir', 'stat_path', 'tree', 'read_file', 'write_file', 'edit_file', 'apply_patch', 'run_command', 'start_process', 'get_agent_bootstrap', 'get_project_context', 'list_skills', 'record_progress', 'checkpoint_thread']
      },
      browser: {
        purpose: 'Web/browser automation using preassigned profiles and CDP ports.',
        tools: ['list_browser_profiles', 'browser_status', 'list_browser_tabs', 'browser_visible_state', 'browser_tail', 'browser_manage_tabs', 'browser_click_and_wait', 'browser_upload_file_and_verify', 'browser_cdp_call', 'browser_cdp_batch']
      },
      computer: {
        purpose: 'Local GUI/computer use; independent from machine administration.',
        tools: ['cua_driver_status', 'cua_driver_call', 'cua_driver_batch']
      },
      computer_windows: {
        purpose: 'Windows desktop computer use with monitor capture, UIA, mouse, keyboard, clipboard, windows, and app launch.',
        full_macro: 'api_sets.computer_windows grants the complete Windows computer-use surface.',
        partial_rights: 'Use windows_computer.enabled plus individual allow_* rights for narrower lanes such as non-screenshot validation.',
        tools: ['windows_computer_status', 'windows_list_monitors', 'windows_screenshot', 'windows_uia_tree', 'windows_launch_app', 'windows_click', 'windows_type_text', 'windows_batch']
      },
      machine_admin: {
        purpose: 'Own-machine/lane management through configured commands/processes and scoped service/config/runbook work.',
        tools: ['run_configured_command', 'run_command', 'start_process', 'list_processes', 'read_process', 'write_process', 'stop_process']
      },
      estate_admin: {
        purpose: 'Cross-agent/cross-host Genesis control-plane reporting and approved estate operations.',
        tools: ['genesis_bootstrap', 'genesis_estate_overview', 'genesis_agent_deep_dive', 'genesis_host_deep_dive', 'genesis_safe_diagnostic']
      }
    },
    examples: {
      catalyst: ['workspace', 'browser'],
      cortex: ['workspace', 'browser', 'machine_admin'],
      boba: ['workspace', 'browser', 'computer', 'machine_admin'],
      genesis: ['workspace', 'browser', 'computer', 'computer_windows', 'machine_admin', 'estate_admin']
    },
    policy_flags: ['external_actions', 'destructive_actions', 'secret_return', 'credential_use']
  };
}

function apiBehavior() {
  return {
    webchat_genesis: { tools: ['genesis_bootstrap', 'genesis_estate_overview', 'genesis_agent_deep_dive', 'genesis_host_deep_dive', 'genesis_safe_diagnostic'], posture: 'read-heavy coarse control-plane reports with hard no-secrets/no-mutation boundaries' },
    run_recovery: 'Every HTTP JSON API tool/batch response includes api.run_id. Use get_gateway_run / GET /api/v1/runs/{run_id} to recover status/results instead of blindly retrying.',
    idempotency: 'For writes, browser actions, commands, checkpoints, and other non-idempotent operations, send a stable idempotency_key so retries do not duplicate work.',
    async_polling: {
      running_status: 'api.status=running',
      operation_status_field: 'api.operation_status',
      operation_id_field: 'api.run_id',
      operation_id_alias: 'api.operation_id',
      poll_field: 'api.poll_after_ms',
      poll_field_alias: 'api.next_poll_after_ms',
      default_poll_after_ms: 5000,
      statuses: ['queued', 'running', 'waiting_for_navigation', 'waiting_for_dom', 'waiting_for_upload', 'waiting_for_user', 'completed', 'blocked_by_login', 'blocked_by_captcha', 'timed_out', 'failed'],
      instruction: 'When a response has api.status=running, wait at least api.poll_after_ms, then call get_gateway_run with api.run_id. Do not retry the original tool call unless the run is missing or explicitly failed.'
    },
    browser_semantic_layer: {
      compact_tools: ['browser_visible_state', 'browser_tail', 'browser_manage_tabs', 'browser_click_and_wait', 'browser_upload_file_and_verify'],
      direction: 'Keep browser truth generic and business workflow judgment in repo helpers/scripts.'
    },
    browser_targets: {
      list_browser_tabs_default: 'real page targets only',
      filters: ['type/page/all', 'include_iframes', 'include_workers', 'include_browser_ui'],
      note: 'By default list_browser_tabs hides workers, iframe-like targets, and browser UI targets. Pass type=all or include_* flags for raw CDP target cleanup/debugging.'
    }
  };
}

function toolAsync() {
  return {
    browser_cdp_browser_call: quotaSaverAsync(),
    browser_cdp_browser_batch: quotaSaverAsync(),
    browser_cdp_call: quotaSaverAsync(),
    browser_cdp_batch: quotaSaverAsync(),
    cua_driver_call: quotaSaverAsync('Cua Driver'),
    cua_driver_batch: quotaSaverAsync('Cua Driver'),
    search_files: quotaSaverAsync('workspace search'),
    run_command: quotaSaverAsync('workspace command'),
    read_process: { may_return_running: false, tail_supported: true, cursor_field: 'cursor', next_cursor_field: 'data.next_cursor', note: 'For long-running commands, prefer start_process plus read_process(cursor) to retrieve only new buffered output.' },
    browser_tail: { may_return_running: false, tail_supported: true, cursor_field: 'cursor', next_cursor_field: 'data.next_cursor', note: 'For long-running browser observation, call browser_tail with cursor=previous next_cursor to retrieve visible-state deltas.' },
    get_gateway_run: { may_return_running: false, note: 'Poll/recovery endpoint for prior HTTP JSON API run_id values.' }
  };
}

function quotaSaverAsync(surface = 'browser/CDP') {
  return {
    may_return_running: true,
    default_async_mode: 'quota_saver',
    ready_behavior: 'returns completed result immediately if ready within initial_wait_ms',
    initial_wait_ms_default: 5000,
    initial_wait_ms_max: 10000,
    poll_after_ms_min: 5000,
    response_aliases: { operation_id: 'api.run_id', next_poll_after_ms: 'api.poll_after_ms', operation_status: 'api.status' },
    possible_operation_statuses: ['running', 'completed', 'timed_out', 'failed', 'waiting_for_navigation', 'waiting_for_dom', 'waiting_for_upload', 'waiting_for_user', 'blocked_by_login', 'blocked_by_captcha'],
    opt_out: 'Pass async_mode=sync or async_mode=off for old fully synchronous behavior.',
    client_rule: `If api.status=running, wait at least api.poll_after_ms, then call get_gateway_run with api.run_id. Do not retry the original ${surface} command.`
  };
}

function aliases(): Record<string, string> {
  return {
    Read: 'read_file',
    Write: 'write_file',
    Edit: 'edit_file',
    Bash: 'run_command',
    Shell: 'run_command',
    Grep: 'search_files',
    Glob: 'list_dir',
    exec: 'run_command'
  };
}

function deprecatedTools(): Record<string, string> {
  return {
    exec: 'run_command',
    process_start: 'start_process',
    process_list: 'list_processes',
    process_log: 'read_process',
    process_kill: 'stop_process'
  };
}
