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
  run_command: spec({ workspace_id: 'string required', cmd_array: 'string[] required', cwd: 'string optional', timeout_ms: 'number optional', max_stdout_bytes: 'number optional', max_stderr_bytes: 'number optional', tail: 'boolean optional', cmd: 'legacy string[] alias only' }, { cmd: ['cmd_array'] }),
  start_process: spec({ workspace_id: 'string required', cmd_array: 'string[] preferred', command: 'legacy string optional', cwd: 'string optional', timeout_ms: 'number optional' }),
  read_process: spec({ workspace_id: 'string required', process_id: 'string required', max_bytes: 'number optional', cursor: 'number optional' }),
  write_process: spec({ workspace_id: 'string required', process_id: 'string required', input: 'string required', close_stdin: 'boolean optional' }),
  stop_process: spec({ workspace_id: 'string required', process_id: 'string required' }),
  windows_screenshot: spec({ workspace_id: 'string required', monitor: 'string optional', visual_followup: 'object optional', job_id: 'string optional', threaddex_job_id: 'string optional', threaddex_base_url: 'string optional' })
};

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
