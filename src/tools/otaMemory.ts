import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ok } from '../core/result.js';
import type { Workspace } from '../core/workspaces.js';

export type OtaMemoryOperation = 'memory.begin_turn' | 'memory.commit_turn' | 'memory.flush_session';
export const OTA_MEMORY_TOOL_NAMES = ['memory_begin_turn', 'memory_commit_turn', 'memory_flush_session'] as const;
type JsonObject = Record<string, unknown>;
type MemoryTarget = { databasePath: string; packageRoot: string; scope: JsonObject };

export async function otaMemoryCall(workspace: Workspace, operation: OtaMemoryOperation, args: JsonObject, sanitizeResults = false) {
  const config = workspace.ota_memory;
  if (!config?.enabled) throw new Error('OTA-Memory is not configured for this workspace');
  const target = await resolveTarget(workspace, optionalString(args.execution_handle));
  const arguments_ = lifecycleArguments(operation, args, target.scope);
  const receipt = await invokeAdapter(workspace, operation, target.packageRoot, target.databasePath, arguments_, sanitizeResults);
  return ok(`${operation} ${String(receipt.status ?? 'completed')}`, receipt);
}

function lifecycleArguments(operation: OtaMemoryOperation, args: JsonObject, scope: JsonObject): JsonObject {
  const common = { request_id: requiredString(args.request_id, 'request_id'), scope, session: optionalObject(args.session) };
  if (operation === 'memory.begin_turn') return compact({
    ...common, intent: requiredString(args.intent, 'intent'), resume_seed: optionalString(args.resume_seed),
    relationship_mode: optionalString(args.relationship_mode), budget: optionalObject(args.budget)
  });
  const write = { ...common, idempotency_key: requiredString(args.idempotency_key, 'idempotency_key') };
  if (operation === 'memory.commit_turn') return { ...write, candidates: requiredArray(args.candidates, 'candidates') };
  return compact({
    ...write, reason: optionalString(args.reason), active_task: optionalString(args.active_task),
    transcript_summary: optionalString(args.transcript_summary), decisions: optionalArray(args.decisions),
    open_questions: optionalArray(args.open_questions), artifacts: optionalArray(args.artifacts),
    risks: optionalArray(args.risks), next_actions: optionalArray(args.next_actions),
    source_record_refs: optionalArray(args.source_record_refs), budget: optionalObject(args.budget)
  });
}

async function resolveTarget(workspace: Workspace, executionHandle?: string): Promise<MemoryTarget> {
  const config = requiredConfig(workspace);
  if (!executionHandle) return targetFromConfig(workspace, config);
  if (!config.fixture_handles_file) throw new Error('execution_handle is not enabled for this workspace');
  const store = await readHandleStore(config.fixture_handles_file);
  const entry = optionalObject(optionalObject(store.handles)?.[executionHandle]);
  if (!entry) throw new Error('unknown or expired OTA-Memory execution_handle');
  assertNotExpired(entry.expires_at);
  return targetFromEntry(workspace, config, entry);
}

async function readHandleStore(file: string): Promise<JsonObject> {
  try {
    const value = JSON.parse(await readFile(file, 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid store');
    return value as JsonObject;
  } catch {
    throw new Error('OTA-Memory execution-handle store is unavailable or invalid');
  }
}

function targetFromConfig(workspace: Workspace, config: NonNullable<Workspace['ota_memory']>): MemoryTarget {
  return {
    databasePath: absolutePath(config.database_path, 'ota_memory.database_path'),
    packageRoot: absolutePath(config.package_root, 'ota_memory.package_root'),
    scope: configuredScope(workspace, config)
  };
}

function targetFromEntry(workspace: Workspace, config: NonNullable<Workspace['ota_memory']>, entry: JsonObject): MemoryTarget {
  return {
    databasePath: absolutePath(entry.database_path, 'fixture database_path'),
    packageRoot: absolutePath(entry.package_root ?? config.package_root, 'fixture package_root'),
    scope: configuredScope(workspace, {
      ...config,
      project_id: requiredString(entry.project_id, 'fixture project_id'),
      workspace_id: optionalString(entry.workspace_id) ?? config.workspace_id,
      agent_id: optionalString(entry.agent_id) ?? config.agent_id,
      user_id: optionalString(entry.user_id) ?? config.user_id,
      scope_type: optionalString(entry.scope_type) ?? config.scope_type,
      privacy: optionalString(entry.privacy) ?? config.privacy
    })
  };
}

function configuredScope(workspace: Workspace, config: NonNullable<Workspace['ota_memory']>): JsonObject {
  return {
    project_id: requiredString(config.project_id, 'ota_memory.project_id'),
    workspace_id: config.workspace_id ?? workspace.id,
    agent_id: config.agent_id ?? workspace.id,
    user_id: config.user_id,
    scope_type: config.scope_type,
    privacy: config.privacy
  };
}

async function invokeAdapter(workspace: Workspace, operation: OtaMemoryOperation, packageRoot: string, databasePath: string, args: JsonObject, sanitizeResults: boolean): Promise<JsonObject> {
  const config = requiredConfig(workspace);
  const request = JSON.stringify({ operation, database_path: databasePath, arguments: args });
  let output: string;
  try { output = await runPython(config.python_executable, packageRoot, request, config.timeout_ms); }
  catch (error) { throw new Error(redactAdapterError(error, [packageRoot, databasePath, config.python_executable], sanitizeResults)); }
  try { return JSON.parse(output) as JsonObject; }
  catch { throw new Error('OTA-Memory adapter returned invalid JSON'); }
}

function redactAdapterError(error: unknown, paths: string[], enabled: boolean): string {
  let message = error instanceof Error ? error.message : String(error);
  if (!enabled) return message;
  for (const value of paths.filter(Boolean)) message = message.replaceAll(value, '[server-path]');
  return message;
}

function runPython(executable: string, cwd: string, input: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ['-m', 'memory_api.gateway_adapter'], { cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('OTA-Memory adapter timed out')); }, timeoutMs);
    child.stdout.on('data', (chunk) => { stdout = boundedAppend(stdout, chunk); });
    child.stderr.on('data', (chunk) => { stderr = boundedAppend(stderr, chunk); });
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(`OTA-Memory adapter failed (${code}): ${stderr.trim() || 'no diagnostic'}`));
    });
    child.stdin.end(input);
  });
}

function requiredConfig(workspace: Workspace): NonNullable<Workspace['ota_memory']> {
  if (!workspace.ota_memory?.enabled) throw new Error('OTA-Memory is not configured for this workspace');
  return workspace.ota_memory;
}

function absolutePath(value: unknown, name: string): string {
  const result = requiredString(value, name);
  if (!path.isAbsolute(result)) throw new Error(`${name} must be absolute`);
  return result;
}

function assertNotExpired(value: unknown): void {
  if (value === undefined) return;
  const expires = Date.parse(requiredString(value, 'fixture expires_at'));
  if (!Number.isFinite(expires) || expires <= Date.now()) throw new Error('unknown or expired OTA-Memory execution_handle');
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required`);
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function optionalObject(value: unknown): JsonObject | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : undefined;
}

function requiredArray(value: unknown, name: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${name} must be an array`);
  return value;
}

function optionalArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function compact(value: JsonObject): JsonObject {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function boundedAppend(current: string, chunk: unknown): string {
  const next = current + String(chunk);
  return next.length <= 1_000_000 ? next : next.slice(0, 1_000_000);
}
