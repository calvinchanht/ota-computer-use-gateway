export type ApiContract = {
  operation: string;
  expected_shape: Record<string, unknown>;
  schema_url: string;
};

export type UnsupportedParameter = {
  path: string;
  received_type: string;
  supported_alternatives?: string[];
};

type ContractSpec = {
  expected_shape: Record<string, unknown>;
  allowed: string[];
  alternatives?: Record<string, string[]>;
};

const API_SCHEMA_URL = '/ota/api/v1/schema';
const COMMON = ['workspace_id', 'async_mode', 'browser_async_mode', 'initial_wait_ms', 'sync_wait_ms', 'poll_after_ms'];
const PROFILE = [...COMMON, 'profile_label'];

const CONTRACTS: Record<string, ContractSpec> = {
  heartbeat: spec({}),
  workspace_status: spec({}),
  get_tool_profile: spec({}),
  get_workspace_policy: spec({ workspace_id: 'string required' }),
  estate_bootstrap: spec({ workspace_id: 'string required' }),
  estate_overview: spec({ workspace_id: 'string required' }),
  estate_agent_deep_dive: spec({ workspace_id: 'string required', agent: 'string required' }),
  estate_host_deep_dive: spec({ workspace_id: 'string required', host: 'string required' }),
  estate_safe_diagnostic: spec({ workspace_id: 'string required', scope: 'estate|agent|host optional', target: 'string optional' }),
  browser_click_and_wait: spec({
    workspace_id: 'string required',
    profile_label: 'string optional',
    target_id: 'string required',
    selector: 'string optional',
    text: 'string optional',
    wait_for_text: 'string optional',
    wait_for_selector: 'string optional',
    wait_for_url_contains: 'string optional',
    wait_until_stable: 'boolean optional',
    timeout_ms: 'number optional'
  }, {
    url: ['wait_for_url_contains'],
    wait_for: ['wait_for_text', 'wait_for_selector', 'wait_for_url_contains', 'wait_until_stable']
  }),
  browser_cdp_call: spec({ workspace_id: 'string required', profile_label: 'string optional', target_id: 'string required', method: 'CDP method string required', params: 'object optional' }),
  browser_cdp_batch: spec({ workspace_id: 'string required', profile_label: 'string optional', target_id: 'string required', calls: 'array required' }),
  browser_cdp_browser_call: spec({ workspace_id: 'string required', profile_label: 'string optional', method: 'CDP method string required', params: 'object optional' }),
  browser_cdp_browser_batch: spec({ workspace_id: 'string required', profile_label: 'string optional', calls: 'array required' }),
  list_browser_tabs: spec({ workspace_id: 'string required', profile_label: 'string optional', include_urls: 'boolean optional', type: 'string optional', target_type: 'string optional', include_iframes: 'boolean optional', include_workers: 'boolean optional', include_browser_ui: 'boolean optional' }),
  browser_visible_state: spec({ workspace_id: 'string required', profile_label: 'string optional', target_id: 'string required' }),
  browser_tail: spec({ workspace_id: 'string required', profile_label: 'string optional', target_id: 'string required', cursor: 'number optional' }),
  browser_manage_tabs: spec({ workspace_id: 'string required', profile_label: 'string optional', action: 'string required', url_contains: 'string optional', title_contains: 'string optional', target_id: 'string optional', include_urls: 'boolean optional', max_close: 'number optional' }),
  browser_upload_file_and_verify: spec({ workspace_id: 'string required', profile_label: 'string optional', target_id: 'string required', selector: 'string required', path: 'string required', verify_visible_text: 'string optional', timeout_ms: 'number optional' }),
  infer_file_structure: spec({ workspace_id: 'string required', path: 'string required' }),
  sample_file: spec({ workspace_id: 'string required', path: 'string required', mode: 'string optional', head_lines: 'integer optional', tail_lines: 'integer optional', random_lines: 'integer optional', max_bytes: 'integer optional' }),
  read_file_chunk: spec({ workspace_id: 'string required', path: 'string required', offset: 'integer optional', max_bytes: 'integer optional' }),
  read_file_lines: spec({ workspace_id: 'string required', path: 'string required', start_line: 'integer optional', max_lines: 'integer optional' }),
  read_around: spec({ workspace_id: 'string required', path: 'string required', line: 'integer required', before: 'integer optional', after: 'integer optional' }),
  search_file: spec({ workspace_id: 'string required', path: 'string required', query: 'string required', max_matches: 'integer optional', context_lines: 'integer optional' }),
  table_profile: spec({ workspace_id: 'string required', path: 'string required', columns: 'string[] optional' }),
  query_table: spec({ workspace_id: 'string required', path: 'string required', select: 'string[] optional', where: 'object optional', sort: 'array optional', limit: 'integer optional', offset: 'integer optional' }),
  query_table_aggregate: spec({ workspace_id: 'string required', path: 'string required', group_by: 'string[] optional', metrics: 'array optional', where: 'object optional' }),
  json_profile: spec({ workspace_id: 'string required', path: 'string required', depth: 'integer optional', array_samples: 'integer optional' }),
  query_json: spec({ workspace_id: 'string required', path: 'string required', query: 'string required', max_bytes: 'integer optional' }),
  patch_file_lines: spec({ workspace_id: 'string required', path: 'string required', start_line: 'integer required', end_line: 'integer optional', replacement: 'string required', expected_sha256: 'string optional', dry_run: 'boolean optional' }),
  update_table_rows: spec({ workspace_id: 'string required', path: 'string required', where: 'object optional', set: 'object required', dry_run: 'boolean optional', allow_multiple: 'boolean optional' }),
  run_command: spec({ workspace_id: 'string required', cmd_array: 'string[] required', cwd: 'string optional', timeout_ms: 'number optional', max_stdout_bytes: 'number optional', max_stderr_bytes: 'number optional', tail: 'boolean optional', cmd: 'legacy string[] alias only' }, { cmd: ['cmd_array'] }),
    git: spec({ workspace_id: 'string required', cmd_array: 'string[] required', cwd: 'string optional', timeout_ms: 'number optional', max_output_chars: 'number optional' }),
    git_lfs_publish_current_branch: spec({ workspace_id: 'string required', repo_path: 'string optional', remote: 'string optional', branch: 'string optional', force_with_lease_sha: 'full 40-character Git SHA optional' }),
  github: spec({ workspace_id: 'string required', cmd_array: 'string[] required', cwd: 'string optional', timeout_ms: 'number optional', max_output_chars: 'number optional', rate_policy: 'object optional; default off; {preflight?, resource?, min_remaining?, retry_mode?, max_wait_ms?}' }),
  start_process: spec({ workspace_id: 'string required', cmd_array: 'string[] preferred', command: 'legacy string optional', cwd: 'string optional', timeout_ms: 'number optional' }),
  read_process: spec({ workspace_id: 'string required', process_id: 'string required', max_bytes: 'number optional', cursor: 'number optional' }),
  write_process: spec({ workspace_id: 'string required', process_id: 'string required', input: 'string required', close_stdin: 'boolean optional' }),
  stop_process: spec({ workspace_id: 'string required', process_id: 'string required' }),
  windows_screenshot: spec({ workspace_id: 'string required', monitor: 'string optional', visual_followup: 'object optional; may include job_id, agent_id, or conversation_lane', conversation_lane: 'string optional; required for direct lane-scoped delivery', job_id: 'string optional', threaddex_job_id: 'string optional' }),
  windows_window_screenshot: spec({ workspace_id: 'string required', hwnd: 'integer required', visual_followup: 'object optional; may include job_id, agent_id, or conversation_lane', conversation_lane: 'string optional; required for direct lane-scoped delivery', job_id: 'string optional', threaddex_job_id: 'string optional' }),
  windows_window_screenshot_sequence: spec({ workspace_id: 'string required', hwnd: 'integer required', interval_ms: 'integer optional; >=50; requested span <=5000ms', count: 'integer optional; 2..8; default 8', visual_followup: 'object optional; may include job_id, agent_id, or conversation_lane', conversation_lane: 'string optional; required for direct lane-scoped delivery', job_id: 'string optional', threaddex_job_id: 'string optional' }),
  windows_uia_tree: spec({ workspace_id: 'string required', hwnd: 'integer optional; scopes tree to one top-level window', max_nodes: 'integer optional' }),
  windows_list_windows: spec({ workspace_id: 'string required' }),
  windows_focus_window: spec({ workspace_id: 'string required', hwnd: 'integer required' }),
  windows_place_window: spec({ workspace_id: 'string required', hwnd: 'integer required', monitor: 'primary or monitor index string optional', x: 'number optional', y: 'number optional', width: 'positive number optional', height: 'positive number optional' }),
  windows_uia_read: spec({ workspace_id: 'string required', hwnd: 'integer required', automation_id: 'string optional', name: 'string optional', control_type: 'string optional', max_chars: 'integer optional' }),
  windows_uia_set_value: spec({ workspace_id: 'string required', hwnd: 'integer required', automation_id: 'string optional', name: 'string optional', control_type: 'string optional', value: 'string required' }),
  windows_drag: spec({ workspace_id: 'string required', from_x: 'number required', from_y: 'number required', to_x: 'number required', to_y: 'number required', duration_ms: 'integer optional; 0..10000', steps: 'integer optional; 1..200' }),
  windows_window_drag: spec({ workspace_id: 'string required', hwnd: 'integer required', from_x: 'number required', from_y: 'number required', to_x: 'number required', to_y: 'number required', coordinate_space: 'client or window optional', focus: 'boolean optional', duration_ms: 'integer optional; 0..10000', steps: 'integer optional; 1..200' }),
  windows_type_text: spec({ workspace_id: 'string required', text: 'string required', hwnd: 'integer optional; focuses and verifies target before typing' }),
  windows_key: spec({ workspace_id: 'string required', key: 'string required', hwnd: 'integer optional; focuses and verifies target before sending' }),
  windows_hotkey: spec({ workspace_id: 'string required', keys: 'string[] required', hwnd: 'integer optional; focuses and verifies target before sending' }),
  memory_begin_turn: spec({ workspace_id: 'string required', request_id: 'string required', intent: 'string required', execution_handle: 'opaque string optional', session: 'object optional', resume_seed: 'string optional', relationship_mode: 'none|one_hop optional', budget: 'object optional' }),
  memory_commit_turn: spec({ workspace_id: 'string required', request_id: 'string required', idempotency_key: 'string required', candidates: 'array required', execution_handle: 'opaque string optional', session: 'object optional' }),
  memory_flush_session: spec({ workspace_id: 'string required', request_id: 'string required', idempotency_key: 'string required', execution_handle: 'opaque string optional', session: 'object optional', reason: 'string optional', active_task: 'string optional', transcript_summary: 'string optional', decisions: 'array optional', open_questions: 'array optional', artifacts: 'array optional', risks: 'array optional', next_actions: 'array optional', source_record_refs: 'array optional', budget: 'object optional' })
};

export function apiSchemaDocument() {
  return {
    schema_version: '1.0.0',
    schema_url: API_SCHEMA_URL,
    operations: Object.fromEntries(Object.entries(CONTRACTS).map(([operation, contract]) => [operation, contract.expected_shape]))
  };
}

export function apiEnvelopeContract(): ApiContract {
  return {
    operation: 'gateway_request',
    schema_url: API_SCHEMA_URL,
    expected_shape: { operation: 'string required', arguments: 'object optional', tool: 'legacy alias for operation' }
  };
}

export function apiToolContract(operation: string): ApiContract {
  return {
    operation,
    schema_url: API_SCHEMA_URL,
    expected_shape: CONTRACTS[operation]?.expected_shape ?? { workspace_id: 'string required for workspace operations' }
  };
}

export function validateApiToolArguments(operation: string, args: Record<string, unknown>) {
  const contract = apiToolContract(operation);
  const spec = CONTRACTS[operation];
  if (!spec) return { ok: true as const, contract };
  const unsupported = unsupportedParameters(args, spec);
  if (unsupported.length === 0) return { ok: true as const, contract };
  return {
    ok: false as const,
    status: 400,
    body: {
      ok: false,
      error: 'unsupported_parameters',
      error_code: 'unsupported_parameters',
      message: `Unsupported parameter(s): ${unsupported.map((item) => item.path).join(', ')}`,
      unsupported_parameters: unsupported,
      contract,
      recovery: recovery('fix_request_and_retry', 'Remove unsupported parameters or replace them with the listed supported alternatives, then retry the same operation.')
    }
  };
}

export function invalidJsonResponse() {
  return {
    ok: false,
    error: 'invalid_json',
    error_code: 'invalid_json',
    message: 'Request body is not valid JSON. Escape quotes inside string values or send structured values as valid JSON fields.',
    contract: apiEnvelopeContract(),
    recovery: recovery('fix_request_and_retry', 'Fix the JSON syntax and retry the same request.')
  };
}

export function apiShapeErrorResponse(body: Record<string, unknown>) {
  return {
    ...body,
    contract: apiEnvelopeContract(),
    recovery: recovery('fix_request_and_retry', 'Reshape the request to match contract.expected_shape, then retry.')
  };
}

function spec(expected_shape: Record<string, unknown>, alternatives: Record<string, string[]> = {}): ContractSpec {
  return { expected_shape, allowed: Object.keys(expected_shape), alternatives };
}

function unsupportedParameters(args: Record<string, unknown>, spec: ContractSpec): UnsupportedParameter[] {
  const allowed = new Set([...spec.allowed, ...COMMON, ...PROFILE]);
  return Object.keys(args)
    .filter((key) => !allowed.has(key))
    .sort()
    .map((key) => ({
      path: `arguments.${key}`,
      received_type: valueType(args[key]),
      supported_alternatives: spec.alternatives?.[key]
    }));
}

function recovery(kind: string, instruction: string): Record<string, string> {
  return { kind, instruction };
}

function valueType(value: unknown): string {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  return typeof value;
}
