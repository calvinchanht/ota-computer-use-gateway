import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname } from 'node:path';
import type { IncomingMessage } from 'node:http';
import type { AppConfig } from '../config/schema.js';
import type { ApiShapeErrorBody } from './apiRequest.js';

const API_TOOL_PATH = '/api/v1/tool';

type OtaMisuseEvent = {
  event_type: 'api_shape_misuse';
  schema_version: 1;
  timestamp: string;
  source: Record<string, unknown>;
  request_context: Record<string, unknown>;
  misuse: Record<string, unknown>;
  sample: { redacted_shape_only: true; value_hashes?: Record<string, string>; value_types?: Record<string, string>; sizes?: Record<string, number> };
  fingerprint: string;
};

export function reportApiShapeMisuse(config: AppConfig, req: IncomingMessage, body: unknown, error: ApiShapeErrorBody, expectedShapeId: string, hintId: string): void {
  void sendMisuseReport(config, otaMisuseEventForApiShapeError(req.url?.split('?')[0], body, error, expectedShapeId, hintId)).catch(() => undefined);
}

export function otaMisuseEventForApiShapeError(httpPath: string | undefined, body: unknown, error: ApiShapeErrorBody, expectedShapeId: string, hintId: string): OtaMisuseEvent {
  const source = body && typeof body === 'object' ? body as Record<string, unknown> : {};
  return buildMisuseEvent({
    workspace_id: workspaceIdFromBody(body), http_path: httpPath, operation: stringField(source.operation) ?? stringField(source.tool),
    error_code: error.error_code, received_top_level_keys: error.received_top_level_keys, received_argument_keys: error.received_argument_keys,
    expected_shape_id: expectedShapeId, hint_id: hintId
  });
}

export async function reportToolMisuse(config: AppConfig, tool: string, args: Record<string, unknown>, summary: string): Promise<void> {
  const event = otaMisuseEventForToolError(tool, args, summary);
  if (!event) return;
  await sendMisuseReport(config, event).catch(() => undefined);
}

export function otaMisuseEventForToolError(tool: string, args: Record<string, unknown>, summary: string): OtaMisuseEvent | null {
  const details = toolMisuseDetails(tool, args, summary);
  return details ? buildMisuseEvent(details) : null;
}

function toolMisuseDetails(tool: string, args: Record<string, unknown>, summary: string): Record<string, unknown> | null {
  const exposure = toolExposureMisuse(tool, args, summary);
  if (exposure) return exposure;
  const runCommand = runCommandShapeMisuse(tool, args, summary);
  if (runCommand) return runCommand;
  const startProcess = startProcessShapeMisuse(tool, args, summary);
  if (startProcess) return startProcess;
  const common = commonToolShapeMisuse(tool, args, summary);
  if (common) return common;
  if (isJobLifecycleMisuse(tool, summary)) return jobLifecycleMisuse(tool, args);
  return null;
}

function jobLifecycleMisuse(tool: string, args: Record<string, unknown>): Record<string, unknown> {
  return {
    workspace_id: stringField(args.workspace_id), operation: tool, error_code: 'blocked_job_lifecycle_via_ota',
    received_argument_keys: Object.keys(args).sort(), bad_field: 'operation', bad_field_type: 'string',
    expected_shape_id: 'threaddex.native_job_lifecycle.v1', hint_id: 'use_native_threaddex_job_api_actions'
  };
}

function toolExposureMisuse(tool: string, args: Record<string, unknown>, summary: string): Record<string, unknown> | null {
  if (!summary.startsWith('tool is not exposed by this workspace api_sets profile:') && !summary.startsWith('tool is not exposed by this server:')) return null;
  const serverScoped = summary.startsWith('tool is not exposed by this server:');
  return {
    workspace_id: stringField(args.workspace_id), operation: tool, error_code: serverScoped ? 'tool_not_exposed_by_server' : 'tool_not_exposed_by_profile',
    received_argument_keys: Object.keys(args).sort(), bad_field: 'operation', bad_field_type: 'string',
    expected_shape_id: serverScoped ? 'server.exposed_tools.tool_exposure.v1' : 'workspace.api_sets.tool_exposure.v1', hint_id: serverScoped ? 'add_tool_to_server_exposed_tools_or_remove_tool' : 'enable_matching_api_set_or_remove_tool',
    value_hashes: hashField('operation', tool), value_types: { operation: 'string' }
  };
}

function runCommandShapeMisuse(tool: string, args: Record<string, unknown>, summary: string): Record<string, unknown> | null {
  if (tool !== 'run_command') return null;
  if (summary.includes('cmd must be an array')) return { ...fieldMisuse(tool, args, 'cmd', 'run_command.argv.v1', 'use_cmd_array'), error_code: 'invalid_run_command_shape' };
  if (summary === 'cmd_array must be an array') return fieldMisuse(tool, args, 'cmd_array', 'run_command.argv.v1', 'use_cmd_array');
  if (summary === 'array item is required') return fieldMisuse(tool, args, 'cmd_array', 'run_command.argv_items_string.v1', 'use_cmd_array_of_strings');
  if (summary.startsWith('cmd_array/cmd conflict')) return fieldMisuse(tool, args, 'cmd_array', 'run_command.single_argv_field.v1', 'remove_legacy_cmd_or_match_cmd_array');
  return null;
}

function startProcessShapeMisuse(tool: string, args: Record<string, unknown>, summary: string): Record<string, unknown> | null {
  if (tool !== 'start_process') return null;
  if (summary === 'cmd_array must be an array') return fieldMisuse(tool, args, 'cmd_array', 'start_process.argv.v1', 'use_cmd_array');
  if (summary === 'array item is required') return fieldMisuse(tool, args, 'cmd_array', 'start_process.argv_items_string.v1', 'use_cmd_array_of_strings');
  if (summary === 'command is required') return fieldMisuse(tool, args, 'command', 'start_process.command_string_legacy.v1', 'prefer_cmd_array_or_use_command_string');
  if (summary.startsWith('start_process cmd_array/command conflict')) return fieldMisuse(tool, args, 'cmd_array', 'start_process.single_command_field.v1', 'remove_legacy_command_or_use_cmd_array_only');
  return null;
}

function commonToolShapeMisuse(tool: string, args: Record<string, unknown>, summary: string): Record<string, unknown> | null {
  const batch = batchToolShapeMisuse(tool, args, summary);
  if (batch) return batch;
  for (const spec of commonToolShapeSpecs(tool)) {
    if (matchesFieldError(summary, spec.field)) return fieldMisuse(tool, args, spec.field, spec.expected_shape_id, spec.hint_id);
  }
  return null;
}

type CommonToolShapeSpec = { field: string; expected_shape_id: string; hint_id: string };

function commonToolShapeSpecs(tool: string): CommonToolShapeSpec[] {
  const specs: CommonToolShapeSpec[] = [];
  addStringFieldSpecs(specs, tool);
  addStructuredFieldSpecs(specs, tool);
  addToolSpecificSpecs(specs, tool);
  return specs;
}

function addStringFieldSpecs(specs: CommonToolShapeSpec[], tool: string): void {
  if (pathStringTools().has(tool)) specs.push({ field: 'path', expected_shape_id: 'filesystem.path_string.v1', hint_id: 'use_path_string' });
  if (queryStringTools().has(tool)) specs.push({ field: 'query', expected_shape_id: `${tool}.query_string.v1`, hint_id: 'use_query_string' });
  if (targetIdTools().has(tool)) specs.push({ field: 'target_id', expected_shape_id: 'browser.target_id_string.v1', hint_id: 'use_target_id_string' });
  if (methodStringTools().has(tool)) specs.push({ field: 'method', expected_shape_id: `${tool}.method_string.v1`, hint_id: 'use_method_string' });
  if (paramsObjectTools().has(tool)) specs.push({ field: 'params', expected_shape_id: `${tool}.params_object.v1`, hint_id: 'use_params_object' });
  if (processIdStringTools().has(tool)) specs.push({ field: 'process_id', expected_shape_id: 'process.process_id_string.v1', hint_id: 'use_process_id_string' });
}

function addStructuredFieldSpecs(specs: CommonToolShapeSpec[], tool: string): void {
  for (const field of ['columns', 'select', 'group_by', 'sort', 'metrics']) {
    const spec = arrayFieldSpec(tool, field);
    if (spec) specs.push(spec);
  }
  for (const field of ['where', 'set']) {
    const spec = objectFieldSpec(tool, field);
    if (spec) specs.push(spec);
  }
}

function addToolSpecificSpecs(specs: CommonToolShapeSpec[], tool: string): void {
  if (tool === 'write_process') specs.push({ field: 'input', expected_shape_id: 'write_process.input_string.v1', hint_id: 'use_input_string' });
  if (tool === 'patch_file_lines') specs.push({ field: 'replacement', expected_shape_id: 'patch_file_lines.replacement_string.v1', hint_id: 'use_replacement_string' });
  if (tool === 'write_file') specs.push({ field: 'content', expected_shape_id: 'write_file.content_string.v1', hint_id: 'use_content_string' });
  if (tool === 'write_binary_file') specs.push({ field: 'base64', expected_shape_id: 'write_binary_file.base64_string.v1', hint_id: 'use_base64_string' });
  if (tool === 'edit_file') specs.push({ field: 'old_text', expected_shape_id: 'edit_file.old_text_string.v1', hint_id: 'use_old_text_string' }, { field: 'new_text', expected_shape_id: 'edit_file.new_text_string.v1', hint_id: 'use_new_text_string' });
}

function arrayFieldSpec(tool: string, field: string): CommonToolShapeSpec | null {
  const arrayFields: Record<string, Set<string>> = {
    columns: new Set(['table_profile']), select: new Set(['query_table']),
    group_by: new Set(['query_table_aggregate']), sort: new Set(['query_table']),
    metrics: new Set(['query_table_aggregate'])
  };
  if (!arrayFields[field]?.has(tool)) return null;
  return { field, expected_shape_id: `${tool}.${field}_array.v1`, hint_id: `use_${field}_array` };
}

function objectFieldSpec(tool: string, field: string): CommonToolShapeSpec | null {
  const objectFields: Record<string, Set<string>> = { where: new Set(['query_table', 'query_table_aggregate', 'update_table_rows']), set: new Set(['update_table_rows']) };
  if (!objectFields[field]?.has(tool)) return null;
  return { field, expected_shape_id: `${tool}.${field}_object.v1`, hint_id: `use_${field}_object` };
}

function pathStringTools(): Set<string> {
  return new Set(['stat_path', 'read_file', 'read_binary_file', 'write_file', 'write_binary_file', 'edit_file', 'delete_file', 'delete_path', 'infer_file_structure', 'sample_file', 'read_file_chunk', 'read_file_lines', 'read_around', 'search_file', 'table_profile', 'query_table', 'query_table_aggregate', 'json_profile', 'patch_file_lines', 'record_artifact']);
}

function queryStringTools(): Set<string> {
  return new Set(['search_file', 'search_files', 'query_json']);
}

function targetIdTools(): Set<string> {
  return new Set(['browser_visible_state', 'browser_tail', 'browser_click_and_wait', 'browser_upload_file_and_verify', 'browser_cdp_call', 'browser_cdp_batch']);
}

function methodStringTools(): Set<string> {
  return new Set(['browser_cdp_browser_call', 'browser_cdp_call', 'cua_driver_call']);
}

function paramsObjectTools(): Set<string> {
  return new Set(['browser_cdp_browser_call', 'browser_cdp_call', 'cua_driver_call']);
}

function processIdStringTools(): Set<string> {
  return new Set(['read_process', 'write_process', 'stop_process']);
}

function batchToolShapeMisuse(tool: string, args: Record<string, unknown>, summary: string): Record<string, unknown> | null {
  if (!batchCallTools().has(tool)) return null;
  if (summary === 'calls array is required') return fieldMisuse(tool, args, 'calls', `${tool}.calls_array.v1`, 'use_calls_array');
  if (summary === 'calls item must be an object') return fieldMisuse(tool, args, 'calls', `${tool}.calls_item_object.v1`, 'use_call_items_as_objects');
  if (/^calls\[\d+\]\.method is required$/.test(summary)) return fieldMisuse(tool, args, 'calls', `${tool}.calls_method_string.v1`, 'use_call_method_string');
  if (/^calls\[\d+\]\.params must be an object$/.test(summary)) return fieldMisuse(tool, args, 'calls', `${tool}.calls_params_object.v1`, 'use_call_params_object');
  return null;
}

function batchCallTools(): Set<string> {
  return new Set(['browser_cdp_browser_batch', 'browser_cdp_batch', 'cua_driver_batch']);
}

function matchesFieldError(summary: string, field: string): boolean {
  return summary === `${field} is required` || summary.startsWith(`${field} must be `) || matchesGenericArrayError(summary, field);
}

function matchesGenericArrayError(summary: string, field: string): boolean {
  if (!['columns', 'select', 'group_by'].includes(field)) return false;
  return summary === 'string array must be an array' || summary === 'array item is required';
}

function fieldMisuse(tool: string, args: Record<string, unknown>, field: string, expectedShapeId: string, hintId: string): Record<string, unknown> {
  const value = args[field];
  return {
    workspace_id: stringField(args.workspace_id), operation: tool, error_code: `${tool}_${field}_shape`,
    received_argument_keys: Object.keys(args).sort(), bad_field: field, bad_field_type: valueType(value),
    expected_shape_id: expectedShapeId, hint_id: hintId, value_hashes: hashField(`arguments.${field}`, value), value_types: { [`arguments.${field}`]: valueType(value) }
  };
}

function isJobLifecycleMisuse(tool: string, summary: string): boolean {
  return ['getJob', 'deliverJob', 'deliverJobProgress', 'requestJobContinuation'].includes(tool) && summary.includes('Threaddex Job API');
}

function buildMisuseEvent(input: Record<string, unknown>): OtaMisuseEvent {
  const event: OtaMisuseEvent = {
    event_type: 'api_shape_misuse', schema_version: 1, timestamp: new Date().toISOString(),
    source: compact({ service: 'ota-computer-use-gateway', workspace_id: input.workspace_id }),
    request_context: compact({ http_path: input.http_path ?? API_TOOL_PATH, operation: input.operation, transport: 'custom_gpt_action', provider_hint: 'chatgpt_custom_gpt' }),
    misuse: compact({ error_code: input.error_code, received_top_level_keys: input.received_top_level_keys, received_argument_keys: input.received_argument_keys, bad_field: input.bad_field, bad_field_type: input.bad_field_type, expected_shape_id: input.expected_shape_id, hint_id: input.hint_id }),
    sample: compact({ redacted_shape_only: true, value_hashes: input.value_hashes, value_types: input.value_types, sizes: input.sizes }) as OtaMisuseEvent['sample'],
    fingerprint: ''
  };
  event.fingerprint = misuseFingerprint(event);
  return event;
}

async function sendMisuseReport(config: AppConfig, event: OtaMisuseEvent): Promise<void> {
  const cfg = config.misuse_reporting;
  if (!cfg || cfg.enabled === false) return;
  if (cfg.local_jsonl_path) await writeLocalMisuseEvent(cfg.local_jsonl_path, event);
  if (cfg.central_url) await forwardMisuseEvent(cfg, event);
}

async function writeLocalMisuseEvent(file: string, event: OtaMisuseEvent): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  await appendFile(file, `${JSON.stringify(event)}\n`, 'utf8');
}

async function forwardMisuseEvent(config: NonNullable<AppConfig['misuse_reporting']>, event: OtaMisuseEvent): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeout_ms ?? 1500);
  try {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    const token = await misuseBearerToken(config);
    if (token) headers.authorization = `Bearer ${token}`;
    await fetch(config.central_url!, { method: 'POST', headers, body: JSON.stringify({ event }), signal: controller.signal });
  } finally { clearTimeout(timer); }
}

async function misuseBearerToken(config: NonNullable<AppConfig['misuse_reporting']>): Promise<string | undefined> {
  if (config.bearer_token_env) return process.env[config.bearer_token_env]?.trim();
  if (config.bearer_token_file) return (await readFile(config.bearer_token_file, 'utf8')).trim();
  return undefined;
}

function misuseFingerprint(event: OtaMisuseEvent): string {
  return `sha256:${createHash('sha256').update(JSON.stringify({ service: event.source.service, operation: event.request_context.operation, error_code: event.misuse.error_code, bad_field: event.misuse.bad_field, bad_field_type: event.misuse.bad_field_type, expected_shape_id: event.misuse.expected_shape_id, hint_id: event.misuse.hint_id })).digest('hex')}`;
}

function workspaceIdFromBody(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const source = body as Record<string, unknown>;
  const args = source.arguments && typeof source.arguments === 'object' && !Array.isArray(source.arguments) ? source.arguments as Record<string, unknown> : source;
  return stringField(args.workspace_id);
}

function hashField(name: string, value: unknown): Record<string, string> | undefined {
  return value === undefined ? undefined : { [name]: `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}` };
}

function valueType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function compact<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}
