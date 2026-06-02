import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { AppConfig } from '../config/schema.js';
import { buildWorkspaces, getWorkspace, type Workspace } from '../core/workspaces.js';
import { audit } from '../core/audit.js';
import { fail, type ToolResult } from '../core/result.js';
import { heartbeat } from '../tools/heartbeat.js';
import { workspaceStatus } from '../tools/workspace.js';
import { toolProfile } from '../tools/toolProfile.js';
import { workspacePolicy } from '../tools/policy.js';
import { deleteFileTool, deletePathTool, editFileTool, listDir, readBinaryFileTool, readFileTool, statPath, treeTool, workspaceInventory, writeBinaryFileTool, writeFileTool } from '../tools/files.js';
import { gitDiff, gitStatus } from '../tools/git.js';
import { genesisAgentDeepDive, genesisBootstrap, genesisEstateOverview, genesisHostDeepDive, genesisSafeDiagnostic } from '../tools/genesis.js';
import { agentBootstrap, checkpointThread, contextSnapshot, recordDecision, recordHandoff, recordProgress, updateCurrentTask } from '../tools/context.js';
import { getProjectContext, memoryWrite } from '../tools/memory.js';
import { browserCdpBatch, browserCdpBrowserBatch, browserCdpBrowserCall, browserCdpCall, browserClickAndWait, browserManageTabs, browserUploadFileAndVerify, browserStatus, browserVisibleState, listBrowserProfiles, listBrowserTabs } from '../tools/browser.js';
import { cuaDriverBatch, cuaDriverCall, cuaDriverStatus, type CuaDriverBatchStep } from '../tools/computer.js';
import { inferFileStructure, jsonProfile, patchFileLines, queryJson, queryTable, queryTableAggregate, readAround, readFileChunk, readFileLinesLarge, sampleFile, searchFile, searchFiles, tableProfile, updateTableRows } from '../tools/largeFiles.js';
import { runArgvTool } from '../tools/runCommand.js';
import { listArtifacts, recordArtifact } from '../tools/artifacts.js';
import { createServer } from './create.js';
import { assertSafeHttpBind, authError, authStartupWarning, isAuthorized } from './auth.js';
import { healthPayload } from './health.js';
import { auditHttpRequest } from './httpAudit.js';
import { RateLimiter } from './rateLimit.js';
import { installShutdownHooks } from './shutdown.js';

const MCP_PATH = '/mcp';
const API_TOOL_PATH = '/api/v1/tool';
const API_BATCH_PATH = '/api/v1/batch';
const API_DEBUG_REQUEST_CONTEXT_PATH = '/api/v1/debug/request_context';
const API_RUNS_PREFIX = '/api/v1/runs/';
const MAX_RUN_RECORDS = 200;

type ApiRunRecord = {
  run_id: string;
  idempotency_key?: string;
  kind: 'tool' | 'batch';
  status: 'running' | 'completed';
  ok: boolean;
  summary: string;
  created_at: string;
  completed_at?: string;
  request: { tool?: string; steps?: Array<{ tool: string }>; thread?: unknown };
  response: unknown;
};

const apiRunRecords = new Map<string, ApiRunRecord>();
const apiRunByIdempotency = new Map<string, string>();

export async function listenHttp(config: AppConfig): Promise<void> {
  assertSafeHttpBind(config);
  const warning = authStartupWarning(config);
  if (warning) console.error(warning);

  const startedAt = Date.now();
  const rateLimiter = new RateLimiter();
  const auditWorkspace = (await buildWorkspaces(config)).values().next().value ?? null;

  const httpServer = createHttpServer((req, res) => {
    auditHttpRequest(auditWorkspace, req, res);
    void handleRequest(config, rateLimiter, startedAt, req, res);
  });

  installShutdownHooks(httpServer);
  httpServer.listen(config.server.port, config.server.host, () => {
    console.error(`OTA gateway MCP HTTP listening on http://${config.server.host}:${config.server.port}${MCP_PATH}`);
  });
}

async function handleRequest(config: AppConfig, rateLimiter: RateLimiter, startedAt: number, req: IncomingMessage, res: ServerResponse) {
  if (isHealth(req)) return sendJson(res, 200, healthPayload(config, startedAt));
  if (req.method === 'OPTIONS') return sendCors(res);
  if (!isMcp(req) && !isApi(req)) return sendJson(res, 404, { error: 'not_found' });
  if (!allowedMethod(req.method)) return sendJson(res, 405, { error: 'method_not_allowed' });
  if (!rateLimiter.check(config, req)) return sendJson(res, 429, { error: 'rate_limited' });
  if (requestTooLarge(config, req)) return sendJson(res, 413, { error: 'payload_too_large' });
  if (!isAuthorized(config, req)) return sendAuthError(config, res);
  if (isApiDebugRequestContext(req)) return handleApiDebugRequestContext(req, res);
  if (isApiRunPath(req)) return handleApiRun(req, res);
  if (isApiTool(req)) return handleApiTool(config, req, res);
  if (isApiBatch(req)) return handleApiBatch(config, req, res);

  applyCors(res);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  const mcpServer = await createServer(config);
  await mcpServer.connect(transport);

  try {
    const parsedBody = req.method === 'POST' ? await readJsonBody(req) : undefined;
    if (parsedBody) logMcpMethods(parsedBody);
    await transport.handleRequest(req, res, parsedBody);
  } catch (error) {
    console.error('MCP HTTP request failed', error);
    if (!res.headersSent) sendJson(res, 500, { error: 'mcp_request_failed' });
    else res.end();
  } finally {
    await transport.close().catch(() => undefined);
  }
}

function isHealth(req: IncomingMessage): boolean {
  return req.url === '/healthz' && req.method === 'GET';
}

function isMcp(req: IncomingMessage): boolean {
  return req.url?.startsWith(MCP_PATH) ?? false;
}

function isApi(req: IncomingMessage): boolean {
  const path = req.url?.split('?')[0];
  return path === API_DEBUG_REQUEST_CONTEXT_PATH || path === API_TOOL_PATH || path === API_BATCH_PATH || isApiRunPath(req);
}

function isApiRunPath(req: IncomingMessage): boolean {
  return req.url?.split('?')[0]?.startsWith(API_RUNS_PREFIX) ?? false;
}


function isApiDebugRequestContext(req: IncomingMessage): boolean {
  return req.url?.split('?')[0] === API_DEBUG_REQUEST_CONTEXT_PATH;
}

function isApiTool(req: IncomingMessage): boolean {
  return req.url?.split('?')[0] === API_TOOL_PATH;
}

function isApiBatch(req: IncomingMessage): boolean {
  return req.url?.split('?')[0] === API_BATCH_PATH;
}

function allowedMethod(method: string | undefined): boolean {
  return method === 'GET' || method === 'POST' || method === 'DELETE';
}

export function requestTooLarge(config: AppConfig, req: IncomingMessage): boolean {
  const raw = req.headers['content-length'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return false;

  const size = Number.parseInt(value, 10);
  return Number.isFinite(size) && size > config.security.max_request_bytes;
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return undefined;
  return JSON.parse(raw);
}

function logMcpMethods(body: unknown): void {
  const messages = Array.isArray(body) ? body : [body];
  const methods = messages
    .map((message) => (message && typeof message === 'object' && 'method' in message ? String((message as { method?: unknown }).method) : null))
    .filter(Boolean);
  if (methods.length > 0) console.error(`MCP HTTP methods: ${methods.join(',')}`);
}

function sendCors(res: ServerResponse): void {
  applyCors(res);
  res.writeHead(204).end();
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  applyCors(res);
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
}

async function handleApiTool(config: AppConfig, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'method_not_allowed' });
  const parsedBody = await readJsonBody(req).catch(() => undefined);
  const idempotencyKey = idempotencyKeyFor(req, parsedBody);
  const existing = existingRun(idempotencyKey);
  if (existing) return sendJson(res, 200, existing.response);
  const request = parseApiToolRequest(parsedBody);
  const args = request.arguments ?? {};
  if (shouldUseQuotaSaver(request.tool, args)) return handleQuotaSaverApiTool(config, res, request.tool, args, idempotencyKey, safeBodyThread(parsedBody));
  const result = await runApiTool(config, request.tool, args);
  const response = { ...result, api: { transport: 'http-json', tool: request.tool, thread: safeBodyThread(parsedBody) } };
  const record = storeApiRun({ kind: 'tool', ok: result.ok, summary: result.summary, response, idempotency_key: idempotencyKey, request: { tool: request.tool, thread: safeBodyThread(parsedBody) } });
  return sendJson(res, 200, attachRun(response, record));
}

async function handleApiBatch(config: AppConfig, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'method_not_allowed' });
  const parsedBody = await readJsonBody(req).catch(() => undefined);
  const idempotencyKey = idempotencyKeyFor(req, parsedBody);
  const existing = existingRun(idempotencyKey);
  if (existing) return sendJson(res, 200, existing.response);
  const steps = parseApiBatchRequest(parsedBody).steps.slice(0, 20);
  const results = [];
  for (let index = 0; index < steps.length; index++) {
    const step = steps[index];
    results.push({ index, tool: step.tool, result: await runApiTool(config, step.tool, step.arguments ?? {}) });
  }
  const ok = results.every((step) => step.result.ok);
  const response = { ok, summary: `completed ${results.length} API batch steps`, data: { results }, api: { transport: 'http-json', thread: safeBodyThread(parsedBody) } };
  const record = storeApiRun({ kind: 'batch', ok, summary: response.summary, response, idempotency_key: idempotencyKey, request: { steps: steps.map((step) => ({ tool: step.tool })), thread: safeBodyThread(parsedBody) } });
  return sendJson(res, 200, attachRun(response, record));
}


function handleApiRun(req: IncomingMessage, res: ServerResponse): void {
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'method_not_allowed' });
  const path = req.url?.split('?')[0] ?? '';
  const runId = decodeURIComponent(path.slice(API_RUNS_PREFIX.length));
  const record = apiRunRecords.get(runId);
  if (!record) return sendJson(res, 404, { ok: false, error: 'run_not_found', run_id: runId });
  return sendJson(res, 200, { ok: true, summary: record.summary, run: record });
}

function idempotencyKeyFor(req: IncomingMessage, body: unknown): string | undefined {
  const header = headerValue(req.headers['idempotency-key']);
  if (header) return header.slice(0, 200);
  if (body && typeof body === 'object') {
    const value = (body as Record<string, unknown>).idempotency_key;
    if (typeof value === 'string' && value) return value.slice(0, 200);
  }
  return undefined;
}

function existingRun(idempotencyKey: string | undefined): ApiRunRecord | undefined {
  if (!idempotencyKey) return undefined;
  const runId = apiRunByIdempotency.get(idempotencyKey);
  return runId ? apiRunRecords.get(runId) : undefined;
}


async function handleQuotaSaverApiTool(config: AppConfig, res: ServerResponse, tool: string, args: Record<string, unknown>, idempotencyKey: string | undefined, thread: unknown): Promise<void> {
  const initialWaitMs = boundedAsyncWaitMs(optionalNumber(args.initial_wait_ms) ?? optionalNumber(args.sync_wait_ms) ?? 5000);
  const pollAfterMs = boundedPollAfterMs(optionalNumber(args.poll_after_ms) ?? 5000);
  const promise = runApiTool(config, tool, args);
  const result = await promiseWithTimeout(promise, initialWaitMs);
  if (result) {
    const response = { ...result, api: { transport: 'http-json', tool, thread, async_mode: 'quota_saver', completed_within_initial_wait_ms: initialWaitMs } };
    const record = storeApiRun({ kind: 'tool', ok: result.ok, summary: result.summary, response, idempotency_key: idempotencyKey, request: { tool, thread } });
    return sendJson(res, 200, attachRun(response, record));
  }

  const record = storeRunningApiRun({
    kind: 'tool',
    ok: true,
    summary: `running ${tool}; poll get_gateway_run after ${pollAfterMs}ms`,
    response: {
      ok: true,
      summary: `running ${tool}; poll get_gateway_run after ${pollAfterMs}ms`,
      data: { status: 'running', operation_status: 'running', next_poll_after_ms: pollAfterMs, poll_after_ms: pollAfterMs, instruction: 'Call get_gateway_run after poll_after_ms. Do not retry the original command.' },
      api: { transport: 'http-json', tool, thread, async_mode: 'quota_saver', status: 'running', operation_status: 'running', wait_reason: initialWaitReason(tool), poll_after_ms: pollAfterMs, next_poll_after_ms: pollAfterMs }
    },
    idempotency_key: idempotencyKey,
    request: { tool, thread }
  });
  promise.then((finished) => completeApiRun(record.run_id, finished, { transport: 'http-json', tool, thread, async_mode: 'quota_saver' })).catch((error) => completeApiRun(record.run_id, fail(error instanceof Error ? error.message : String(error)), { transport: 'http-json', tool, thread, async_mode: 'quota_saver' }));
  return sendJson(res, 202, attachRun(record.response, record));
}

function shouldUseQuotaSaver(tool: string, args: Record<string, unknown>): boolean {
  const mode = optionalString(args.async_mode) ?? optionalString(args.browser_async_mode);
  if (mode === 'off' || mode === 'sync') return false;
  return mode === 'quota_saver' || (mode === undefined && (tool.startsWith('browser_cdp') || tool.startsWith('cua_driver_')) && tool !== 'cua_driver_status');
}

function initialWaitReason(tool: string): string {
  if (tool.startsWith('browser_cdp')) return 'waiting_for_browser';
  if (tool.startsWith('cua_driver')) return 'waiting_for_computer';
  return 'running';
}

function storeRunningApiRun(input: Omit<ApiRunRecord, 'run_id' | 'status' | 'created_at' | 'completed_at'>): ApiRunRecord {
  const now = new Date().toISOString();
  const record: ApiRunRecord = { run_id: randomUUID(), status: 'running', created_at: now, ...input };
  record.response = attachRun(record.response, record);
  rememberApiRun(record);
  return record;
}

function completeApiRun(runId: string, result: ToolResult, api: Record<string, unknown>): void {
  const record = apiRunRecords.get(runId);
  if (!record) return;
  const response = { ...result, api: { ...api, status: 'completed' } };
  record.status = 'completed';
  record.ok = result.ok;
  record.summary = result.summary;
  record.completed_at = new Date().toISOString();
  record.response = attachRun(response, record);
}

async function promiseWithTimeout<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([promise, new Promise<undefined>((resolve) => { timer = setTimeout(() => resolve(undefined), ms); })]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function boundedAsyncWaitMs(value: number): number {
  return Math.min(Math.max(Math.trunc(value), 0), 10000);
}

function boundedPollAfterMs(value: number): number {
  return Math.min(Math.max(Math.trunc(value), 5000), 60000);
}

function storeApiRun(input: Omit<ApiRunRecord, 'run_id' | 'status' | 'created_at' | 'completed_at'>): ApiRunRecord {
  const now = new Date().toISOString();
  const record: ApiRunRecord = { run_id: randomUUID(), status: 'completed', created_at: now, completed_at: now, ...input };
  record.response = attachRun(record.response, record);
  rememberApiRun(record);
  return record;
}

function rememberApiRun(record: ApiRunRecord): void {
  apiRunRecords.set(record.run_id, record);
  if (record.idempotency_key) apiRunByIdempotency.set(record.idempotency_key, record.run_id);
  while (apiRunRecords.size > MAX_RUN_RECORDS) {
    const oldest = apiRunRecords.keys().next().value;
    if (!oldest) break;
    const removed = apiRunRecords.get(oldest);
    apiRunRecords.delete(oldest);
    if (removed?.idempotency_key) apiRunByIdempotency.delete(removed.idempotency_key);
  }
}

function attachRun<T>(response: T, record: Pick<ApiRunRecord, 'run_id' | 'status'>): T & { api: Record<string, unknown> } {
  if (!response || typeof response !== 'object' || Array.isArray(response)) return response as T & { api: Record<string, unknown> };
  const source = response as T & { api?: Record<string, unknown> };
  const api = source.api ?? {};
  return { ...source, api: { ...api, run_id: record.run_id, operation_id: record.run_id, status: record.status, operation_status: api.operation_status ?? record.status } } as T & { api: Record<string, unknown> };
}

async function runApiTool(config: AppConfig, tool: string, args: Record<string, unknown>): Promise<ToolResult> {
  const started = Date.now();
  let workspace: Workspace | null = null;
  try {
    const workspaces = await buildWorkspaces(config);
    const workspaceId = String(args.workspace_id ?? (workspaces.size === 1 ? [...workspaces.keys()][0] : ''));
    workspace = workspaceId ? getWorkspace(workspaces, workspaceId) : null;
    const result = await callApiTool(config, workspaces, workspace, tool, args);
    await audit(workspace, { timestamp: new Date().toISOString(), tool: `api:${tool}`, ok: result.ok, summary: result.summary, duration_ms: Date.now() - started });
    return result;
  } catch (error) {
    const summary = error instanceof Error ? error.message : String(error);
    await audit(workspace, { timestamp: new Date().toISOString(), tool: `api:${tool}`, ok: false, summary, duration_ms: Date.now() - started });
    return fail(summary);
  }
}

async function callApiTool(config: AppConfig, workspaces: Awaited<ReturnType<typeof buildWorkspaces>>, workspace: Workspace | null, tool: string, args: Record<string, unknown>): Promise<ToolResult> {
  if (tool === 'heartbeat') return heartbeat(workspaces);
  if (tool === 'workspace_status') return workspaceStatus(workspaces);
  if (tool === 'get_tool_profile') return toolProfile();
  if (!workspace) throw new Error('workspace_id is required');
  if (tool === 'get_workspace_policy') return workspacePolicy(workspace);
  if (tool === 'workspace_inventory') return workspaceInventory(config, workspace, optionalNumber(args.max_entries));
  if (tool === 'list_dir') return listDir(config, workspace, String(args.path ?? '.'), optionalNumber(args.max_entries));
  if (tool === 'stat_path') return statPath(config, workspace, requiredString(args.path, 'path'));
  if (tool === 'tree') return treeTool(config, workspace, optionalString(args.path) ?? '.', optionalNumber(args.max_entries));
  if (tool === 'read_file') return readFileTool(config, workspace, requiredString(args.path, 'path'), optionalNumber(args.start_line), optionalNumber(args.max_lines));
  if (tool === 'read_binary_file') return readBinaryFileTool(config, workspace, requiredString(args.path, 'path'));
  if (tool === 'write_file') return writeFileTool(config, workspace, requiredString(args.path, 'path'), requiredString(args.content, 'content'), Boolean(args.overwrite));
  if (tool === 'write_binary_file') return writeBinaryFileTool(config, workspace, requiredString(args.path, 'path'), requiredString(args.base64, 'base64'), Boolean(args.overwrite));
  if (tool === 'edit_file') return editFileTool(config, workspace, requiredString(args.path, 'path'), requiredString(args.old_text, 'old_text'), requiredString(args.new_text, 'new_text'));
  if (tool === 'delete_file') return deleteFileTool(config, workspace, requiredString(args.path, 'path'));
  if (tool === 'delete_path') return deletePathTool(config, workspace, requiredString(args.path, 'path'), Boolean(args.recursive));
  if (tool === 'git_status') return gitStatus(workspace);
  if (tool === 'git_diff') return gitDiff(workspace, optionalNumber(args.max_bytes) ?? 20000);
  if (tool === 'get_agent_bootstrap') return agentBootstrap(workspace);
  if (tool === 'get_context_snapshot') return contextSnapshot(workspace);
  if (tool === 'get_project_context') return getProjectContext(workspace);
  if (tool === 'record_progress') return recordProgress(workspace, requiredString(args.title, 'title'), requiredString(args.body, 'body'), Boolean(args.handoff));
  if (tool === 'record_decision') return recordDecision(workspace, requiredString(args.title, 'title'), requiredString(args.body, 'body'));
  if (tool === 'record_handoff') return recordHandoff(workspace, requiredString(args.title, 'title'), requiredString(args.body, 'body'));
  if (tool === 'update_current_task') return updateCurrentTask(workspace, requiredString(args.title, 'title'), requiredString(args.body, 'body'));
  if (tool === 'checkpoint_thread') return checkpointThread(workspace, requiredString(args.title, 'title'), requiredString(args.summary, 'summary'), optionalStringArray(args.next_steps));
  if (tool === 'memory_write') return memoryWrite(workspace, requiredString(args.type, 'type'), requiredString(args.title, 'title'), requiredString(args.body, 'body'), optionalStringArray(args.tags));
  if (tool === 'list_artifacts') return listArtifacts(workspace);
  if (tool === 'record_artifact') return recordArtifact(workspace, requiredString(args.path, 'path'), requiredString(args.title, 'title'), optionalString(args.kind) ?? 'file', optionalString(args.description) ?? '');
  if (tool === 'genesis_bootstrap') return genesisBootstrap();
  if (tool === 'genesis_estate_overview') return genesisEstateOverview();
  if (tool === 'genesis_agent_deep_dive') return genesisAgentDeepDive(requiredString(args.agent, 'agent'));
  if (tool === 'genesis_host_deep_dive') return genesisHostDeepDive(requiredString(args.host, 'host'));
  if (tool === 'genesis_safe_diagnostic') return genesisSafeDiagnostic(optionalString(args.scope) ?? 'estate', optionalString(args.target));
  if (tool === 'list_browser_profiles') return listBrowserProfiles(workspace);
  if (tool === 'browser_status') return browserStatus(workspace, optionalString(args.profile_label));
  if (tool === 'list_browser_tabs') return listBrowserTabs(workspace, optionalString(args.profile_label), Boolean(args.include_urls), browserTargetFilter(args));
  if (tool === 'browser_visible_state') return browserVisibleState(workspace, requiredString(args.target_id, 'target_id'), optionalString(args.profile_label));
  if (tool === 'browser_manage_tabs') return browserManageTabs(workspace, { action: requiredString(args.action, 'action') as any, url_contains: optionalString(args.url_contains), title_contains: optionalString(args.title_contains), target_id: optionalString(args.target_id), include_urls: optionalBoolean(args.include_urls), max_close: optionalNumber(args.max_close) }, optionalString(args.profile_label));
  if (tool === 'browser_click_and_wait') return browserClickAndWait(workspace, { target_id: requiredString(args.target_id, 'target_id'), selector: optionalString(args.selector), text: optionalString(args.text), wait_for_text: optionalString(args.wait_for_text), wait_for_selector: optionalString(args.wait_for_selector), wait_for_url_contains: optionalString(args.wait_for_url_contains), wait_until_stable: optionalBoolean(args.wait_until_stable), timeout_ms: optionalNumber(args.timeout_ms) }, optionalString(args.profile_label));
  if (tool === 'browser_upload_file_and_verify') return browserUploadFileAndVerify(workspace, { target_id: requiredString(args.target_id, 'target_id'), selector: requiredString(args.selector, 'selector'), path: requiredString(args.path, 'path'), verify_visible_text: optionalString(args.verify_visible_text), timeout_ms: optionalNumber(args.timeout_ms) }, optionalString(args.profile_label));
  if (tool === 'browser_cdp_browser_call') return browserCdpBrowserCall(workspace, requiredString(args.method, 'method'), recordArg(args.params, 'params') ?? {}, optionalString(args.profile_label));
  if (tool === 'browser_cdp_browser_batch') return browserCdpBrowserBatch(workspace, requiredCdpBatchSteps(args.calls) as Parameters<typeof browserCdpBrowserBatch>[1], optionalString(args.profile_label));
  if (tool === 'browser_cdp_call') return browserCdpCall(workspace, requiredString(args.target_id, 'target_id'), requiredString(args.method, 'method'), recordArg(args.params, 'params') ?? {}, optionalString(args.profile_label));
  if (tool === 'browser_cdp_batch') return browserCdpBatch(workspace, requiredString(args.target_id, 'target_id'), requiredCdpBatchSteps(args.calls) as Parameters<typeof browserCdpBatch>[2], optionalString(args.profile_label));
  if (tool === 'cua_driver_status') return cuaDriverStatus(workspace);
  if (tool === 'cua_driver_call') return cuaDriverCall(workspace, requiredString(args.method, 'method'), recordArg(args.params, 'params') ?? {});
  if (tool === 'cua_driver_batch') return cuaDriverBatch(workspace, requiredCuaBatchSteps(args.calls));
  if (tool === 'infer_file_structure') return inferFileStructure(config, workspace, requiredString(args.path, 'path'));
  if (tool === 'sample_file') return sampleFile(config, workspace, requiredString(args.path, 'path'), optionalString(args.mode) ?? 'head_tail_random', optionalNumber(args.head_lines) ?? 20, optionalNumber(args.tail_lines) ?? 20, optionalNumber(args.random_lines) ?? 20, optionalNumber(args.max_bytes) ?? 20000);
  if (tool === 'read_file_chunk') return readFileChunk(config, workspace, requiredString(args.path, 'path'), optionalNumber(args.offset) ?? 0, optionalNumber(args.max_bytes) ?? 50000);
  if (tool === 'read_file_lines') return readFileLinesLarge(config, workspace, requiredString(args.path, 'path'), optionalNumber(args.start_line) ?? 1, optionalNumber(args.max_lines) ?? 200);
  if (tool === 'read_around') return readAround(config, workspace, requiredString(args.path, 'path'), optionalNumber(args.line) ?? 1, optionalNumber(args.before) ?? 10, optionalNumber(args.after) ?? 20);
  if (tool === 'search_file') return searchFile(config, workspace, requiredString(args.path, 'path'), requiredString(args.query, 'query'), optionalNumber(args.max_matches) ?? 50, optionalNumber(args.context_lines) ?? 0);
  if (tool === 'search_files') return searchFiles(config, workspace, optionalString(args.root) ?? '.', requiredString(args.query, 'query'), optionalString(args.glob) ?? '**/*', optionalNumber(args.max_matches) ?? 50, optionalNumber(args.context_lines) ?? 0);
  if (tool === 'table_profile') return tableProfile(config, workspace, requiredString(args.path, 'path'), optionalStringArray(args.columns));
  if (tool === 'query_table') return queryTable(config, workspace, requiredString(args.path, 'path'), optionalStringArray(args.select), recordArg(args.where, 'where'), arrayRecordArg(args.sort, 'sort'), optionalNumber(args.limit) ?? 100, optionalNumber(args.offset) ?? 0);
  if (tool === 'query_table_aggregate') return queryTableAggregate(config, workspace, requiredString(args.path, 'path'), optionalStringArray(args.group_by), arrayRecordArg(args.metrics, 'metrics') ?? [{ op: 'count' }], recordArg(args.where, 'where'));
  if (tool === 'json_profile') return jsonProfile(config, workspace, requiredString(args.path, 'path'), optionalNumber(args.depth) ?? 3, optionalNumber(args.array_samples) ?? 3);
  if (tool === 'query_json') return queryJson(config, workspace, requiredString(args.path, 'path'), requiredString(args.query, 'query'), optionalNumber(args.max_bytes) ?? 50000);
  if (tool === 'patch_file_lines') return patchFileLines(config, workspace, requiredString(args.path, 'path'), optionalNumber(args.start_line) ?? 1, optionalNumber(args.end_line) ?? optionalNumber(args.start_line) ?? 1, requiredString(args.replacement, 'replacement'), optionalString(args.expected_sha256), args.dry_run !== false);
  if (tool === 'update_table_rows') return updateTableRows(config, workspace, requiredString(args.path, 'path'), recordArg(args.where, 'where') ?? {}, stringRecordArg(args.set, 'set'), args.dry_run !== false, Boolean(args.allow_multiple));
  if (tool === 'run_command') return runArgvTool(config, workspace, requiredStringArray(args.cmd, 'cmd'), optionalString(args.cwd) ?? '.', optionalNumber(args.timeout_ms) ?? 30000, optionalNumber(args.max_stdout_bytes) ?? 20000, optionalNumber(args.max_stderr_bytes) ?? 8000);
  throw new Error(`unsupported API tool: ${tool}`);
}

function parseApiToolRequest(body: unknown): { tool: string; arguments?: Record<string, unknown> } {
  if (!body || typeof body !== 'object') throw new Error('JSON object body is required');
  const source = body as Record<string, unknown>;
  return { tool: requiredString(source.tool, 'tool'), arguments: recordArg(source.arguments, 'arguments') };
}

function parseApiBatchRequest(body: unknown): { steps: Array<{ tool: string; arguments?: Record<string, unknown> }> } {
  if (!body || typeof body !== 'object') throw new Error('JSON object body is required');
  const steps = (body as Record<string, unknown>).steps;
  if (!Array.isArray(steps)) throw new Error('steps array is required');
  return { steps: steps.map((step) => parseApiToolRequest(step)) };
}

function recordArg(value: unknown, name: string): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} must be an object`);
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value) throw new Error(`${name} is required`);
  return value;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  return requiredString(value, 'string value');
}

function requiredCdpBatchSteps(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value) || value.length === 0) throw new Error('calls array is required');
  return value.map((item) => recordArg(item, 'calls item') ?? {});
}

function requiredCuaBatchSteps(value: unknown): CuaDriverBatchStep[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error('calls array is required');
  return value.map((item, index) => {
    const source = recordArg(item, 'calls item') ?? {};
    if ('delay_ms' in source) return { delay_ms: optionalNumber(source.delay_ms) ?? 0 };
    return { method: requiredString(source.method, `calls[${index}].method`), params: recordArg(source.params, `calls[${index}].params`) ?? {} };
  });
}

function browserTargetFilter(args: Record<string, unknown>) {
  return {
    type: optionalString(args.type) ?? optionalString(args.target_type),
    include_iframes: optionalBoolean(args.include_iframes),
    include_workers: optionalBoolean(args.include_workers),
    include_browser_ui: optionalBoolean(args.include_browser_ui)
  };
}

function optionalStringArray(value: unknown): string[] {
  if (value === undefined) return [];
  return requiredStringArray(value, 'string array');
}

function requiredStringArray(value: unknown, name: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${name} must be an array`);
  return value.map((item) => requiredString(item, 'array item'));
}

function arrayRecordArg(value: unknown, name: string): Array<Record<string, string>> | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error(`${name} must be an array`);
  return value.map((item) => {
    const record = recordArg(item, name) ?? {};
    return Object.fromEntries(Object.entries(record).map(([key, val]) => [key, String(val)]));
  });
}

function stringRecordArg(value: unknown, name: string): Record<string, string> {
  const record = recordArg(value, name) ?? {};
  return Object.fromEntries(Object.entries(record).map(([key, val]) => [key, String(val)]));
}

async function handleApiDebugRequestContext(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST' && req.method !== 'GET') return sendJson(res, 405, { error: 'method_not_allowed' });
  const parsedBody = req.method === 'POST' ? await readJsonBody(req).catch(() => undefined) : undefined;
  return sendJson(res, 200, {
    ok: true,
    summary: 'safe request context captured',
    request: {
      method: req.method,
      path: req.url?.split('?')[0],
      remote_address: req.socket.remoteAddress,
      headers: safeRequestHeaders(req),
      body_thread: safeBodyThread(parsedBody)
    }
  });
}

function safeRequestHeaders(req: IncomingMessage): Record<string, string | undefined> {
  const names = [
    'origin',
    'referer',
    'referrer',
    'user-agent',
    'x-forwarded-for',
    'x-forwarded-host',
    'x-forwarded-proto',
    'cf-connecting-ip',
    'cf-ipcountry',
    'openai-conversation-id',
    'openai-ephemeral-user-id',
    'openai-gpt-id',
    'openai-subdivision-1-iso-code',
    'x-openai-conversation-id',
    'x-openai-project-id',
    'x-openai-gpt-id',
    'x-openai-action-invocation-id'
  ];
  return Object.fromEntries(names.map((name) => [name, headerValue(req.headers[name])]).filter(([, value]) => value !== undefined));
}

function safeBodyThread(body: unknown): unknown {
  if (!body || typeof body !== 'object') return undefined;
  const source = body as Record<string, unknown>;
  return {
    requestor_url: typeof source.requestor_url === 'string' ? source.requestor_url : undefined,
    thread: source.thread && typeof source.thread === 'object' ? source.thread : undefined,
    client_session_id: typeof source.client_session_id === 'string' ? source.client_session_id : undefined
  };
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function sendAuthError(config: AppConfig, res: ServerResponse): void {
  res.setHeader('www-authenticate', 'Bearer');
  sendJson(res, 401, authError(config));
}

function applyCors(res: ServerResponse): void {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('access-control-allow-headers', 'authorization,content-type,idempotency-key,mcp-session-id,mcp-protocol-version,x-openai-conversation-id,x-openai-project-id,x-openai-gpt-id,x-openai-action-invocation-id');
  res.setHeader('access-control-expose-headers', 'mcp-session-id');
}
