import { readFile } from 'node:fs/promises';
import type { BrokeredExecutorJob, ExecutorResult } from './types.js';
import { BROKERED_EXECUTOR_CONTRACT_VERSION } from './types.js';

export const WINDOWS_EXECUTOR_KIND = 'windows_computer_use';
export const WINDOWS_BROKERED_OPERATIONS = ['windows.status', 'windows.list_monitors', 'windows.list_windows', 'windows.screenshot'];

type ToolResponse = { ok?: boolean; summary?: string; data?: unknown; warnings?: string[] };

export type WindowsAdapterOptions = {
  localOtaBaseUrl: string;
  workspaceId: string;
  localOtaBearerToken?: string;
  fetchImpl?: typeof fetch;
};

export function windowsExecutorHeartbeat(executorId: string) {
  return {
    executor_id: executorId,
    executor_kind: WINDOWS_EXECUTOR_KIND,
    contract_version: BROKERED_EXECUTOR_CONTRACT_VERSION,
    supported_operations: WINDOWS_BROKERED_OPERATIONS
  };
}

export async function runWindowsBrokeredOperation(options: WindowsAdapterOptions, job: BrokeredExecutorJob): Promise<ExecutorResult> {
  const started = new Date();
  const mapped = mapWindowsOperation(job.operation_name, job.operation_arguments);
  if (!mapped) return failed('operation_not_allowed', `unsupported Windows operation: ${job.operation_name}`, started);
  try {
    const response = await callOtaTool(options, mapped.tool, mapped.arguments);
    return response.ok ? succeeded(response, started) : failed(classifyToolFailure(job.operation_name, response.summary), response.summary ?? 'Windows operation failed', started);
  } catch (error) {
    return failed('local_ota_unreachable', errorMessage(error), started);
  }
}

export function mapWindowsOperation(operationName: string, args: Record<string, unknown>) {
  if (operationName === 'windows.status') return tool('windows_computer_status', {});
  if (operationName === 'windows.list_monitors') return tool('windows_list_monitors', {});
  if (operationName === 'windows.list_windows') return tool('windows_list_windows', {});
  if (operationName === 'windows.screenshot') return tool('windows_screenshot', { monitor: stringArg(args.monitor_id ?? args.monitor, 'primary') });
  return undefined;
}

async function callOtaTool(options: WindowsAdapterOptions, toolName: string, toolArgs: Record<string, unknown>): Promise<ToolResponse> {
  const url = `${trimSlash(options.localOtaBaseUrl)}/api/v1/tool`;
  const headers = requestHeaders(options.localOtaBearerToken);
  const body = JSON.stringify({ tool: toolName, arguments: { workspace_id: options.workspaceId, ...toolArgs } });
  const response = await (options.fetchImpl ?? fetch)(url, { method: 'POST', headers, body });
  const parsed = await parseJson(response);
  if (!response.ok) throw new Error(`local OTA HTTP ${response.status}: ${JSON.stringify(parsed)}`);
  return parsed as ToolResponse;
}

function succeeded(response: ToolResponse, started: Date): ExecutorResult {
  return { status: 'succeeded', result: resultData(response), artifacts: extractArtifacts(response.data), audit: audit('allowed', started) };
}

function failed(error_code: NonNullable<ExecutorResult['error_code']>, error_message: string, started: Date): ExecutorResult {
  return { status: 'failed', result: {}, artifacts: [], error_code, error_message, audit: audit(error_code === 'operation_not_allowed' ? 'denied' : 'allowed', started) };
}

function resultData(response: ToolResponse): Record<string, unknown> {
  return { summary: response.summary, ...(isRecord(response.data) ? response.data : { data: response.data }) };
}

function extractArtifacts(data: unknown): ExecutorResult['artifacts'] {
  if (!isRecord(data) || !isRecord(data.artifact)) return [];
  return [artifactFrom(data.artifact.preview, 'image/webp'), artifactFrom(data.artifact.full, 'image/png')].filter(Boolean) as ExecutorResult['artifacts'];
}

function artifactFrom(value: unknown, mimeType: string) {
  if (!isRecord(value)) return undefined;
  return {
    kind: 'image',
    mime_type: mimeType,
    url: stringValue(value.readable_url ?? value.url),
    artifact_path: stringValue(value.agent_artifact_path ?? value.path),
    local_path: stringValue(value.local_path),
    sha256: stringValue(value.sha256),
    expires_at: expiryFromUrl(value.readable_url ?? value.url)
  };
}

function classifyToolFailure(operationName: string, summary: unknown): NonNullable<ExecutorResult['error_code']> {
  const text = String(summary ?? '').toLowerCase();
  if (text.includes('not enabled') || text.includes('capability disabled') || text.includes('not exposed')) return 'local_ota_policy_denied';
  if (text.includes('monitor')) return operationName === 'windows.screenshot' ? 'monitor_not_found' : 'operation_failed';
  if (text.includes('powershell')) return 'powershell_execution_failed';
  if (operationName === 'windows.list_windows') return 'window_enumeration_failed';
  if (operationName === 'windows.screenshot') return 'screenshot_capture_failed';
  return 'operation_failed';
}

function requestHeaders(token?: string): Record<string, string> {
  return { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) };
}

async function parseJson(response: Response): Promise<unknown> {
  const text = await response.text();
  try { return text ? JSON.parse(text) : {}; } catch { return { ok: false, summary: text }; }
}

export async function readTokenFile(file: string | undefined): Promise<string | undefined> {
  return file ? (await readFile(file, 'utf8')).trim() : undefined;
}

function audit(policyDecision: string, started: Date) {
  const finished = new Date();
  return { policy_decision: policyDecision, started_at: started.toISOString(), finished_at: finished.toISOString(), duration_ms: finished.getTime() - started.getTime() };
}

function tool(name: string, args: Record<string, unknown>) {
  return { tool: name, arguments: args };
}

function stringArg(value: unknown, fallback: string) {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function trimSlash(value: string) {
  return value.replace(/\/$/, '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function expiryFromUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const expires = safeUrl(value)?.searchParams.get('expires');
  return expires ? new Date(Number(expires) * 1000).toISOString() : undefined;
}

function safeUrl(value: string): URL | undefined {
  try { return new URL(value); } catch { return undefined; }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
