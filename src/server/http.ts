import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { AppConfig } from '../config/schema.js';
import { buildWorkspaces, getWorkspace, type Workspace } from '../core/workspaces.js';
import { audit } from '../core/audit.js';
import { fail, type ToolResult } from '../core/result.js';
import { heartbeat } from '../tools/heartbeat.js';
import { workspaceStatus } from '../tools/workspace.js';
import { toolProfile } from '../tools/toolProfile.js';
import { allowedTools, workspacePolicy } from '../tools/policy.js';
import { deleteFileTool, deletePathTool, editFileTool, listDir, readBinaryFileTool, readFileTool, statPath, treeTool, workspaceInventory, writeBinaryFileTool, writeFileTool } from '../tools/files.js';
import { gitDiff, gitStatus } from '../tools/git.js';
import { genesisAgentDeepDive, genesisBootstrap, genesisEstateOverview, genesisHostDeepDive, genesisSafeDiagnostic } from '../tools/genesis.js';
import { agentBootstrap, checkpointThread, contextSnapshot, recordDecision, recordHandoff, recordProgress, updateCurrentTask } from '../tools/context.js';
import { getProjectContext, memoryWrite } from '../tools/memory.js';
import { browserCdpBatch, browserCdpBrowserBatch, browserCdpBrowserCall, browserCdpCall, browserClickAndWait, browserManageTabs, browserUploadFileAndVerify, browserStatus, browserTail, browserVisibleState, listBrowserProfiles, listBrowserTabs } from '../tools/browser.js';
import { computerScreenClick, computerScreenDrag, computerScreenMouseMove, computerScreenScroll, computerWindowClick, computerWindowDrag, computerWindowMouseMove, computerWindowScroll, cuaDriverBatch, cuaDriverCall, cuaDriverStatus, type CuaDriverBatchStep } from '../tools/computer.js';
import { inferFileStructure, jsonProfile, patchFileLines, queryJson, queryTable, queryTableAggregate, readAround, readFileChunk, readFileLinesLarge, sampleFile, searchFile, searchFiles, tableProfile, updateTableRows } from '../tools/largeFiles.js';
import { runArgvTailTool, runArgvTool } from '../tools/runCommand.js';
import { processKill, processList, processLog, processStart, processWrite } from '../tools/processes.js';
import { listArtifacts, recordArtifact } from '../tools/artifacts.js';
import { createServer } from './create.js';
import { assertSafeHttpBind, authError, authStartupWarning, isAuthorized } from './auth.js';
import { healthPayload } from './health.js';
import { hasValidArtifactSignature } from './artifactSignatures.js';
import { auditHttpRequest } from './httpAudit.js';
import { RateLimiter } from './rateLimit.js';
import { installShutdownHooks } from './shutdown.js';

const MCP_PATH = '/mcp';
const API_TOOL_PATH = '/api/v1/tool';
const API_BATCH_PATH = '/api/v1/batch';
const API_DEBUG_REQUEST_CONTEXT_PATH = '/api/v1/debug/request_context';
const API_RUNS_PREFIX = '/api/v1/runs/';
const API_ARTIFACTS_PREFIX = '/api/v1/artifacts/';
const OTA_PATH_PREFIX = '/ota';
const THREADEX_PATH_PREFIX = '/threaddex';
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
    console.error(`OTA gateway HTTP API listening on http://${config.server.host}:${config.server.port}/api/v1/tool; compatibility transport at ${MCP_PATH}`);
  });
}

async function handleRequest(config: AppConfig, rateLimiter: RateLimiter, startedAt: number, req: IncomingMessage, res: ServerResponse) {
  stripOtaPathPrefix(req);
  if (isHealth(req)) return sendJson(res, 200, healthPayload(config, startedAt));
  if (req.method === 'OPTIONS') return sendCors(res);
  if (!isMcp(req) && !isApi(req) && !isThreaddexApi(req)) return sendJson(res, 404, { error: 'not_found' });
  if (!allowedMethod(req.method)) return sendJson(res, 405, { error: 'method_not_allowed' });
  if (!rateLimiter.check(config, req)) return sendJson(res, 429, { error: 'rate_limited' });
  if (requestTooLarge(config, req)) return sendJson(res, 413, { error: 'payload_too_large' });
  const signedArtifact = isApiArtifactPath(req) && hasValidArtifactSignature(req);
  if (!signedArtifact && !isAuthorized(config, req)) return sendAuthError(config, res);
  if (isApiDebugRequestContext(req)) return handleApiDebugRequestContext(req, res);
  if (isThreaddexApi(req)) return handleThreaddexApi(req, res);
  if (isApiArtifactPath(req)) return handleApiArtifact(config, req, res);
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
    console.error('compatibility transport request failed', error);
    if (!res.headersSent) sendJson(res, 500, { error: 'mcp_request_failed' });
    else res.end();
  } finally {
    await transport.close().catch(() => undefined);
  }
}

function stripOtaPathPrefix(req: IncomingMessage): void {
  if (!req.url) return;
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname !== OTA_PATH_PREFIX && !url.pathname.startsWith(`${OTA_PATH_PREFIX}/`)) return;
  url.pathname = url.pathname.slice(OTA_PATH_PREFIX.length) || '/';
  req.url = `${url.pathname}${url.search}`;
}

function isHealth(req: IncomingMessage): boolean {
  return req.url === '/healthz' && req.method === 'GET';
}

function isMcp(req: IncomingMessage): boolean {
  return req.url?.startsWith(MCP_PATH) ?? false;
}

function isApi(req: IncomingMessage): boolean {
  const path = req.url?.split('?')[0];
  return path === API_DEBUG_REQUEST_CONTEXT_PATH || path === API_TOOL_PATH || path === API_BATCH_PATH || isApiRunPath(req) || isApiArtifactPath(req);
}

function isThreaddexApi(req: IncomingMessage): boolean {
  return req.url?.split('?')[0]?.startsWith(`${THREADEX_PATH_PREFIX}/`) ?? false;
}

function isApiArtifactPath(req: IncomingMessage): boolean {
  return req.url?.split('?')[0]?.startsWith(API_ARTIFACTS_PREFIX) ?? false;
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

async function readApiJsonBody(req: IncomingMessage): Promise<{ ok: true; body: unknown } | { ok: false; status: number; error: string }> {
  try {
    return { ok: true, body: await readJsonBody(req) };
  } catch {
    return { ok: false, status: 400, error: 'invalid_json' };
  }
}

function logMcpMethods(body: unknown): void {
  const messages = Array.isArray(body) ? body : [body];
  const methods = messages
    .map((message) => (message && typeof message === 'object' && 'method' in message ? String((message as { method?: unknown }).method) : null))
    .filter(Boolean);
  if (methods.length > 0) console.error(`compatibility transport methods: ${methods.join(',')}`);
}

function sendCors(res: ServerResponse): void {
  applyCors(res);
  res.writeHead(204).end();
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  applyCors(res);
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
}


async function handleThreaddexApi(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const rawUrl = new URL(req.url ?? '/', 'http://localhost');
  const path = rawUrl.pathname;
  if (path === `${THREADEX_PATH_PREFIX}/v1/schema` && req.method === 'GET') {
    return sendJson(res, 200, { ok: true, service: 'threaddex-job-api-proxy', protocol_version: 'job-api/1.0.1', schema_version: '1.0.3' });
  }
  const match = path.match(/^\/threaddex\/v1\/job\/([^/]+)(?:\/(progress|deliver|continuation))?$/);
  if (!match) return sendJson(res, 404, { ok: false, error: 'not_found' });
  const [, encodedJobId, action] = match;
  if (!encodedJobId) return sendJson(res, 400, { ok: false, error: 'job_id_required' });
  if (!action && req.method !== 'GET') return sendJson(res, 405, { ok: false, error: 'method_not_allowed' });
  if (action && req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method_not_allowed' });
  const body = req.method === 'POST' ? await readJsonBody(req).catch(() => undefined) : undefined;
  const localPath = `/v1/job/${encodedJobId}${action ? `/${action}` : ''}`;
  const base = threaddexJobApiBaseUrl();
  const headers = await threaddexProxyHeaders(req.method === 'POST');
  const upstream = await fetch(`${base}${localPath}`, { method: req.method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const contentType = upstream.headers.get('content-type') ?? 'application/json';
  const text = await upstream.text();
  if (!upstream.ok) return sendJson(res, upstream.status, threaddexProxyErrorBody(upstream.status, localPath, text));
  applyCors(res);
  res.writeHead(upstream.status, { 'content-type': contentType }).end(text);
}

export function threaddexProxyErrorBody(status: number, localPath: string, text: string): Record<string, unknown> {
  const upstream = parseUpstreamError(text);
  const error = stringValue(upstream.error) ?? `threaddex_upstream_${status}`;
  return {
    ...upstream,
    ok: false,
    error,
    proxy: 'threaddex',
    upstream_status: status,
    upstream_path: localPath,
    hint: threaddexProxyHint(status, error, localPath)
  };
}

function parseUpstreamError(text: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : { upstream_body_preview: text.slice(0, 500) };
  } catch {
    return { upstream_body_preview: text.slice(0, 500) };
  }
}

function threaddexProxyHint(status: number, error: string, localPath: string): string {
  if (status === 404 && error === 'job_not_found') return `The job id was not found in this agent host. Verify the job belongs to this CustomGPT/action host before retrying: ${localPath}`;
  if (status === 401) return 'The Threaddex proxy could not authorize to the local Job API. Check hidden Action auth and server-side bearer configuration; do not print tokens.';
  if (status === 409) return 'The local Job API rejected the current job state or schema. Report this response visibly with secrets redacted.';
  return 'The Threaddex proxy received a non-2xx local Job API response. Report this response visibly with secrets redacted.';
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

async function threaddexProxyHeaders(hasBody: boolean): Promise<Record<string, string>> {
  const headers: Record<string, string> = {};
  if (hasBody) headers['content-type'] = 'application/json';
  const token = await threaddexProxyBearerToken();
  if (token) headers.authorization = `Bearer ${token}`;
  return headers;
}

async function threaddexProxyBearerToken(): Promise<string | undefined> {
  const direct = process.env.THREADEX_JOB_API_BEARER_TOKEN ?? process.env.THREADEX_VISUAL_FOLLOWUP_BEARER_TOKEN;
  if (direct) return direct;
  const file = process.env.THREADEX_JOB_API_BEARER_TOKEN_FILE ?? process.env.THREADEX_VISUAL_FOLLOWUP_BEARER_TOKEN_FILE;
  if (!file) return undefined;
  return (await readFile(file, 'utf8')).trim();
}

function threaddexJobApiBaseUrl(): string {
  return (process.env.THREADEX_JOB_API_BASE_URL ?? process.env.THREADEX_VISUAL_FOLLOWUP_BASE_URL ?? 'http://127.0.0.1:33986').replace(/\/$/, '');
}

async function handleApiTool(config: AppConfig, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'method_not_allowed' });
  const parsed = await readApiJsonBody(req);
  if (!parsed.ok) return sendJson(res, parsed.status, { ok: false, error: parsed.error });
  const parsedBody = parsed.body;
  const idempotencyKey = idempotencyKeyFor(req, parsedBody);
  const existing = existingRun(idempotencyKey);
  if (existing) return sendJson(res, 200, existing.response);
  const request = parseApiToolRequestSafe(parsedBody);
  if (!request.ok) return sendJson(res, request.status, { ok: false, error: request.error });
  const args = request.value.arguments ?? {};
  if (shouldUseQuotaSaver(request.value.tool, args)) return handleQuotaSaverApiTool(config, res, request.value.tool, args, idempotencyKey, safeBodyThread(parsedBody));
  const result = await runApiTool(config, request.value.tool, args);
  const response = { ...result, api: { transport: 'http-json', tool: request.value.tool, thread: safeBodyThread(parsedBody) } };
  const record = storeApiRun({ kind: 'tool', ok: result.ok, summary: result.summary, response, idempotency_key: idempotencyKey, request: { tool: request.value.tool, thread: safeBodyThread(parsedBody) } });
  return sendJson(res, 200, attachRun(response, record));
}

async function handleApiBatch(config: AppConfig, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'method_not_allowed' });
  const parsed = await readApiJsonBody(req);
  if (!parsed.ok) return sendJson(res, parsed.status, { ok: false, error: parsed.error });
  const parsedBody = parsed.body;
  const idempotencyKey = idempotencyKeyFor(req, parsedBody);
  const existing = existingRun(idempotencyKey);
  if (existing) return sendJson(res, 200, existing.response);
  const parsedBatch = parseApiBatchRequestSafe(parsedBody);
  if (!parsedBatch.ok) return sendJson(res, parsedBatch.status, { ok: false, error: parsedBatch.error });
  const steps = parsedBatch.value.steps.slice(0, 20);
  const thread = safeBodyThread(parsedBody);
  if (shouldUseQuotaSaverBatch(steps)) return handleQuotaSaverApiBatch(config, res, steps, idempotencyKey, thread, parsedBody);
  const result = await runApiBatchSteps(config, steps);
  const response = { ...result, api: { transport: 'http-json', thread } };
  const record = storeApiRun({ kind: 'batch', ok: result.ok, summary: response.summary, response, idempotency_key: idempotencyKey, request: { steps: steps.map((step) => ({ tool: step.tool })), thread } });
  return sendJson(res, 200, attachRun(response, record));
}



async function handleQuotaSaverApiBatch(config: AppConfig, res: ServerResponse, steps: Array<{ tool: string; arguments?: Record<string, unknown> }>, idempotencyKey: string | undefined, thread: unknown, body: unknown): Promise<void> {
  const initialWaitMs = boundedAsyncWaitMs(batchOptionalNumber(steps, 'initial_wait_ms') ?? batchOptionalNumber(steps, 'sync_wait_ms') ?? 5000);
  const pollAfterMs = boundedPollAfterMs(batchOptionalNumber(steps, 'poll_after_ms') ?? 5000);
  const promise = runApiBatchSteps(config, steps);
  const result = await promiseWithTimeout(promise, initialWaitMs);
  if (result) {
    const response = { ...result, api: { transport: 'http-json', thread, async_mode: 'quota_saver', completed_within_initial_wait_ms: initialWaitMs } };
    const record = storeApiRun({ kind: 'batch', ok: result.ok, summary: result.summary, response, idempotency_key: idempotencyKey, request: { steps: steps.map((step) => ({ tool: step.tool })), thread } });
    return sendJson(res, 200, attachRun(response, record));
  }

  const record = storeRunningApiRun({
    kind: 'batch',
    ok: true,
    summary: `running batch; poll get_gateway_run after ${pollAfterMs}ms`,
    response: {
      ok: true,
      summary: `running batch; poll get_gateway_run after ${pollAfterMs}ms`,
      data: { status: 'running', operation_status: 'running', next_poll_after_ms: pollAfterMs, poll_after_ms: pollAfterMs, instruction: 'Call get_gateway_run after poll_after_ms. Do not retry the original batch.' },
      api: { transport: 'http-json', thread: safeBodyThread(body), async_mode: 'quota_saver', status: 'running', operation_status: 'running', wait_reason: 'running_batch', poll_after_ms: pollAfterMs, next_poll_after_ms: pollAfterMs }
    },
    idempotency_key: idempotencyKey,
    request: { steps: steps.map((step) => ({ tool: step.tool })), thread }
  });
  promise.then((finished) => completeApiRun(record.run_id, finished, { transport: 'http-json', thread, async_mode: 'quota_saver' })).catch((error) => completeApiRun(record.run_id, fail(error instanceof Error ? error.message : String(error)), { transport: 'http-json', thread, async_mode: 'quota_saver' }));
  return sendJson(res, 202, attachRun(record.response, record));
}

async function runApiBatchSteps(config: AppConfig, steps: Array<{ tool: string; arguments?: Record<string, unknown> }>): Promise<ToolResult> {
  const results = [];
  for (let index = 0; index < steps.length; index++) {
    const step = steps[index];
    results.push({ index, tool: step.tool, result: await runApiTool(config, step.tool, step.arguments ?? {}) });
  }
  return { ok: results.every((step) => step.result.ok), summary: `completed ${results.length} API batch steps`, data: { results }, truncated: false, warnings: [] };
}

function shouldUseQuotaSaverBatch(steps: Array<{ tool: string; arguments?: Record<string, unknown> }>): boolean {
  return steps.some((step) => shouldUseQuotaSaver(step.tool, step.arguments ?? {}));
}

function batchOptionalNumber(steps: Array<{ arguments?: Record<string, unknown> }>, key: string): number | undefined {
  for (const step of steps) {
    const value = optionalNumber(step.arguments?.[key]);
    if (value !== undefined) return value;
  }
  return undefined;
}

async function handleApiArtifact(config: AppConfig, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'method_not_allowed' });
  const parsed = parseArtifactRequest(req);
  if (!parsed) return sendJson(res, 400, { ok: false, error: 'invalid_artifact_path' });
  const workspaces = await buildWorkspaces(config);
  const workspace = getWorkspace(workspaces, parsed.workspace_id);
  const resolved = resolveServedArtifactPath(workspace, parsed.artifact_path);
  if (!resolved) return sendJson(res, 403, { ok: false, error: 'artifact_path_not_allowed' });
  const info = await stat(resolved).catch(() => null);
  if (!info?.isFile()) return sendJson(res, 404, { ok: false, error: 'artifact_not_found' });
  const body = await readFile(resolved);
  applyCors(res);
  res.writeHead(200, {
    'content-type': artifactContentType(resolved),
    'content-length': String(body.length),
    'cache-control': 'private, max-age=300, no-transform',
    'content-disposition': `inline; filename="${path.basename(resolved).replaceAll('\"', '')}"`,
    'x-content-type-options': 'nosniff'
  }).end(body);
}

function parseArtifactRequest(req: IncomingMessage): { workspace_id: string; artifact_path: string } | null {
  const rawPath = req.url?.split('?')[0] ?? '';
  const rest = rawPath.slice(API_ARTIFACTS_PREFIX.length);
  const slash = rest.indexOf('/');
  if (slash <= 0) return null;
  const workspaceId = decodeURIComponent(rest.slice(0, slash));
  const artifactPath = decodeURIComponent(rest.slice(slash + 1));
  if (!workspaceId || !artifactPath) return null;
  return { workspace_id: workspaceId, artifact_path: artifactPath };
}

function resolveServedArtifactPath(workspace: Workspace, artifactPath: string): string | null {
  const normalized = path.posix.normalize(artifactPath.replaceAll('\\', '/'));
  if (normalized.startsWith('../') || normalized === '..' || path.isAbsolute(normalized)) return null;
  if (!normalized.startsWith('.agent/artifacts/')) return null;
  const relativeToAgent = normalized.slice('.agent/'.length);
  const absolute = path.resolve(workspace.realAgentDir, relativeToAgent);
  const artifactsRoot = path.resolve(workspace.realAgentDir, 'artifacts');
  const rel = path.relative(artifactsRoot, absolute);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return absolute;
}

function artifactContentType(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.json')) return 'application/json';
  if (lower.endsWith('.txt') || lower.endsWith('.log')) return 'text/plain; charset=utf-8';
  return 'application/octet-stream';
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

export function shouldUseQuotaSaver(tool: string, args: Record<string, unknown>): boolean {
  const mode = optionalString(args.async_mode) ?? optionalString(args.browser_async_mode);
  if (mode === 'off' || mode === 'sync') return false;
  return mode === 'quota_saver' || (mode === undefined && defaultQuotaSaverTool(tool));
}

function defaultQuotaSaverTool(tool: string): boolean {
  if (tool === 'run_command' || tool === 'search_files') return true;
  if (tool === 'cua_driver_status') return false;
  return tool.startsWith('browser_cdp') || tool.startsWith('cua_driver_') || tool.startsWith('computer_');
}

function initialWaitReason(tool: string): string {
  if (tool.startsWith('browser_cdp')) return 'waiting_for_browser';
  if (tool.startsWith('cua_driver') || tool.startsWith('computer_')) return 'waiting_for_computer';
  if (tool === 'search_files') return 'searching_workspace';
  if (tool === 'run_command') return 'running_command';
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
    const exposed = config.server.exposed_tools ?? [];
    if (exposed.length > 0 && !exposed.includes(tool)) throw new Error(`tool is not exposed by this server: ${tool}`);
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
  if (!allowedTools(workspace).includes(tool)) throw new Error(toolExposureError(tool));
  if (tool === 'workspace_inventory') return workspaceInventory(config, workspace, optionalNumber(args.max_entries));
  if (tool === 'list_dir') return listDir(config, workspace, String(args.path ?? '.'), optionalNumber(args.max_entries));
  if (tool === 'stat_path') return statPath(config, workspace, requiredString(args.path, 'path'));
  if (tool === 'tree') return treeTool(config, workspace, optionalString(args.path) ?? '.', optionalNumber(args.max_entries));
  if (tool === 'read_file') return readFileTool(config, workspace, requiredString(args.path, 'path'), optionalNumber(args.start_line), optionalNumber(args.max_lines));
  if (tool === 'read_binary_file') return readBinaryFileTool(config, workspace, requiredString(args.path, 'path'));
  if (tool === 'write_file') return writeFileTool(config, workspace, requiredString(args.path, 'path'), requiredTextArg(args.content, 'content', true), Boolean(args.overwrite));
  if (tool === 'write_binary_file') return writeBinaryFileTool(config, workspace, requiredString(args.path, 'path'), requiredString(args.base64, 'base64'), Boolean(args.overwrite));
  if (tool === 'edit_file') return editFileTool(config, workspace, requiredString(args.path, 'path'), requiredTextArg(args.old_text, 'old_text'), requiredTextArg(args.new_text, 'new_text', true));
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
  if (tool === 'browser_tail') return browserTail(workspace, requiredString(args.target_id, 'target_id'), optionalNumber(args.cursor), optionalString(args.profile_label));
  if (tool === 'browser_manage_tabs') return browserManageTabs(workspace, { action: requiredString(args.action, 'action') as any, url_contains: optionalString(args.url_contains), title_contains: optionalString(args.title_contains), target_id: optionalString(args.target_id), include_urls: optionalBoolean(args.include_urls), max_close: optionalNumber(args.max_close) }, optionalString(args.profile_label));
  if (tool === 'browser_click_and_wait') return browserClickAndWait(workspace, { target_id: requiredString(args.target_id, 'target_id'), selector: optionalString(args.selector), text: optionalString(args.text), wait_for_text: optionalString(args.wait_for_text), wait_for_selector: optionalString(args.wait_for_selector), wait_for_url_contains: optionalString(args.wait_for_url_contains), wait_until_stable: optionalBoolean(args.wait_until_stable), timeout_ms: optionalNumber(args.timeout_ms) }, optionalString(args.profile_label));
  if (tool === 'browser_upload_file_and_verify') return browserUploadFileAndVerify(workspace, { target_id: requiredString(args.target_id, 'target_id'), selector: requiredString(args.selector, 'selector'), path: requiredString(args.path, 'path'), verify_visible_text: optionalString(args.verify_visible_text), timeout_ms: optionalNumber(args.timeout_ms) }, optionalString(args.profile_label));
  if (tool === 'browser_cdp_browser_call') return browserCdpBrowserCall(workspace, requiredString(args.method, 'method'), recordArg(args.params, 'params') ?? {}, optionalString(args.profile_label));
  if (tool === 'browser_cdp_browser_batch') return browserCdpBrowserBatch(workspace, requiredCdpBatchSteps(args.calls) as Parameters<typeof browserCdpBrowserBatch>[1], optionalString(args.profile_label));
  if (tool === 'browser_cdp_call') return browserCdpCall(workspace, requiredString(args.target_id, 'target_id'), requiredString(args.method, 'method'), recordArg(args.params, 'params') ?? {}, optionalString(args.profile_label));
  if (tool === 'browser_cdp_batch') return browserCdpBatch(workspace, requiredString(args.target_id, 'target_id'), requiredCdpBatchSteps(args.calls) as Parameters<typeof browserCdpBatch>[2], optionalString(args.profile_label));
  if (tool === 'cua_driver_status') return cuaDriverStatus(workspace);
  if (tool === 'cua_driver_call') return cuaDriverCall(workspace, requiredString(args.method, 'method'), recordArg(args.params, 'params') ?? {});
  if (tool === 'computer_screen_click') return computerScreenClick(workspace, requiredNumber(args.x, 'x'), requiredNumber(args.y, 'y'), optionalString(args.button) ?? 'left', optionalNumber(args.click_count) ?? 1);
  if (tool === 'computer_window_click') return computerWindowClick(workspace, requiredNumber(args.pid, 'pid'), requiredNumber(args.x, 'x'), requiredNumber(args.y, 'y'), optionalNumber(args.window_id), optionalString(args.button) ?? 'left', optionalNumber(args.click_count) ?? 1);
  if (tool === 'computer_screen_mouse_move') return computerScreenMouseMove(workspace, requiredNumber(args.x, 'x'), requiredNumber(args.y, 'y'));
  if (tool === 'computer_window_mouse_move') return computerWindowMouseMove(workspace, requiredNumber(args.pid, 'pid'), requiredNumber(args.x, 'x'), requiredNumber(args.y, 'y'), optionalNumber(args.window_id));
  if (tool === 'computer_screen_drag') return computerScreenDrag(workspace, requiredNumber(args.from_x, 'from_x'), requiredNumber(args.from_y, 'from_y'), requiredNumber(args.to_x, 'to_x'), requiredNumber(args.to_y, 'to_y'), optionalString(args.button) ?? 'left', optionalNumber(args.duration_ms), optionalNumber(args.steps));
  if (tool === 'computer_window_drag') return computerWindowDrag(workspace, requiredNumber(args.pid, 'pid'), requiredNumber(args.from_x, 'from_x'), requiredNumber(args.from_y, 'from_y'), requiredNumber(args.to_x, 'to_x'), requiredNumber(args.to_y, 'to_y'), optionalNumber(args.window_id), optionalString(args.button) ?? 'left', optionalNumber(args.duration_ms), optionalNumber(args.steps));
  if (tool === 'computer_screen_scroll') return computerScreenScroll(workspace, requiredNumber(args.x, 'x'), requiredNumber(args.y, 'y'), requiredString(args.direction, 'direction'), optionalNumber(args.amount) ?? 3, optionalString(args.by) ?? 'line');
  if (tool === 'computer_window_scroll') return computerWindowScroll(workspace, requiredNumber(args.pid, 'pid'), requiredString(args.direction, 'direction'), optionalNumber(args.window_id), optionalNumber(args.amount) ?? 3, optionalString(args.by) ?? 'line');
  if (tool === 'cua_driver_batch') return cuaDriverBatch(workspace, requiredCuaBatchSteps(args.calls));
  if (tool === 'infer_file_structure') return inferFileStructure(config, workspace, requiredString(args.path, 'path'));
  if (tool === 'sample_file') return sampleFile(config, workspace, requiredString(args.path, 'path'), optionalString(args.mode) ?? 'head_tail_random', optionalNumber(args.head_lines) ?? 20, optionalNumber(args.tail_lines) ?? 20, optionalNumber(args.random_lines) ?? 20, optionalNumber(args.max_bytes) ?? 20000);
  if (tool === 'read_file_chunk') return readFileChunk(config, workspace, requiredString(args.path, 'path'), optionalNumber(args.offset) ?? 0, optionalNumber(args.max_bytes) ?? 50000);
  if (tool === 'read_file_lines') return readFileLinesLarge(config, workspace, requiredString(args.path, 'path'), optionalNumber(args.start_line) ?? 1, optionalNumber(args.max_lines) ?? 200);
  if (tool === 'read_around') return readAround(config, workspace, requiredString(args.path, 'path'), optionalNumber(args.line) ?? 1, optionalNumber(args.before) ?? 10, optionalNumber(args.after) ?? 20);
  if (tool === 'search_file') return searchFile(config, workspace, requiredString(args.path, 'path'), requiredString(args.query, 'query'), optionalNumber(args.max_matches) ?? 50, optionalNumber(args.context_lines) ?? 0);
  if (tool === 'search_files') return searchFiles(config, workspace, optionalString(args.root) ?? optionalString(args.path) ?? '.', requiredString(args.query, 'query'), optionalString(args.glob) ?? '**/*', optionalNumber(args.max_matches) ?? 50, optionalNumber(args.context_lines) ?? 0);
  if (tool === 'table_profile') return tableProfile(config, workspace, requiredString(args.path, 'path'), optionalStringArray(args.columns));
  if (tool === 'query_table') return queryTable(config, workspace, requiredString(args.path, 'path'), optionalStringArray(args.select), recordArg(args.where, 'where'), arrayRecordArg(args.sort, 'sort'), optionalNumber(args.limit) ?? 100, optionalNumber(args.offset) ?? 0);
  if (tool === 'query_table_aggregate') return queryTableAggregate(config, workspace, requiredString(args.path, 'path'), optionalStringArray(args.group_by), arrayRecordArg(args.metrics, 'metrics') ?? [{ op: 'count' }], recordArg(args.where, 'where'));
  if (tool === 'json_profile') return jsonProfile(config, workspace, requiredString(args.path, 'path'), optionalNumber(args.depth) ?? 3, optionalNumber(args.array_samples) ?? 3);
  if (tool === 'query_json') return queryJson(config, workspace, requiredString(args.path, 'path'), requiredString(args.query, 'query'), optionalNumber(args.max_bytes) ?? 50000);
  if (tool === 'patch_file_lines') return patchFileLines(config, workspace, requiredString(args.path, 'path'), optionalNumber(args.start_line) ?? 1, optionalNumber(args.end_line) ?? optionalNumber(args.start_line) ?? 1, requiredString(args.replacement, 'replacement'), optionalString(args.expected_sha256), args.dry_run !== false);
  if (tool === 'update_table_rows') return updateTableRows(config, workspace, requiredString(args.path, 'path'), recordArg(args.where, 'where') ?? {}, stringRecordArg(args.set, 'set'), args.dry_run !== false, Boolean(args.allow_multiple));
  if (tool === 'start_process') return processStart(config, workspace, requiredString(args.command, 'command'));
  if (tool === 'list_processes') return processList();
  if (tool === 'read_process') return processLog(requiredString(args.process_id, 'process_id'), optionalNumber(args.max_bytes) ?? 50000, optionalNumber(args.cursor));
  if (tool === 'write_process') return processWrite(requiredString(args.process_id, 'process_id'), requiredString(args.input, 'input'), Boolean(args.close_stdin));
  if (tool === 'stop_process') return processKill(requiredString(args.process_id, 'process_id'));
  if (tool === 'run_command' && Boolean(args.tail)) return runArgvTailTool(config, workspace, requiredStringArray(args.cmd, 'cmd'), optionalString(args.cwd) ?? '.', optionalNumber(args.timeout_ms) ?? 30000);
  if (tool === 'run_command') return runArgvTool(config, workspace, requiredStringArray(args.cmd, 'cmd'), optionalString(args.cwd) ?? '.', optionalNumber(args.timeout_ms) ?? 30000, optionalNumber(args.max_stdout_bytes) ?? 20000, optionalNumber(args.max_stderr_bytes) ?? 8000);
  throw new Error(`unsupported API tool: ${tool}`);
}


function toolExposureError(tool: string): string {
  if (tool === 'deliverJob') return 'tool is not exposed by the OTA capability gateway. Use the Threaddex Job API path on the same agent host, for example /threaddex/v1/job/{job_id}/deliver.';
  if (tool === 'deliverJobProgress') return 'tool is not exposed by the OTA capability gateway. Use the Threaddex Job API path on the same agent host, for example /threaddex/v1/job/{job_id}/progress.';
  if (tool === 'getJob') return 'tool is not exposed by the OTA capability gateway. Use the Threaddex Job API path on the same agent host, for example /threaddex/v1/job/{job_id}.';
  return `tool is not exposed by this workspace api_sets profile: ${tool}`;
}

type ApiToolRequest = { tool: string; arguments?: Record<string, unknown> };

function parseApiToolRequestSafe(body: unknown): { ok: true; value: ApiToolRequest } | { ok: false; status: number; error: string } {
  try {
    return { ok: true, value: parseApiToolRequest(body) };
  } catch (error) {
    return { ok: false, status: 400, error: error instanceof Error ? error.message : String(error) };
  }
}

function parseApiBatchRequestSafe(body: unknown): { ok: true; value: { steps: ApiToolRequest[] } } | { ok: false; status: number; error: string } {
  try {
    return { ok: true, value: parseApiBatchRequest(body) };
  } catch (error) {
    return { ok: false, status: 400, error: error instanceof Error ? error.message : String(error) };
  }
}

export function parseApiToolRequest(body: unknown): ApiToolRequest {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('JSON object body is required');
  const source = body as Record<string, unknown>;
  const topOperation = requestOperation(source.operation, source.tool);
  const args = requestArguments(source);
  const nestedOperation = !topOperation && args ? requestOperation(args.operation, args.tool) : undefined;
  const operation = topOperation ?? nestedOperation;
  if (!operation) throw new Error(expectedRequestError(source, args));
  const normalizedArgs = nestedOperation && args ? omitOperationKeys(args) : args;
  return { tool: operation, arguments: normalizedArgs };
}

function parseApiBatchRequest(body: unknown): { steps: ApiToolRequest[] } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('JSON object body is required');
  const steps = (body as Record<string, unknown>).steps;
  if (!Array.isArray(steps)) throw new Error('steps array is required');
  return { steps: steps.map((step) => parseApiToolRequest(step)) };
}

function requestOperation(operation: unknown, tool: unknown): string | undefined {
  const op = optionalOperationString(operation, 'operation');
  const legacy = optionalOperationString(tool, 'tool');
  if (op && legacy && op !== legacy) throw new Error(`operation/tool conflict: operation=${op}, tool=${legacy}`);
  return op ?? legacy;
}

function optionalOperationString(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !value) throw new Error(`${name} must be a non-empty string`);
  return value;
}

function requestArguments(source: Record<string, unknown>): Record<string, unknown> | undefined {
  if (source.arguments !== undefined) return recordArg(source.arguments, 'arguments');
  const args = omitEnvelopeKeys(source);
  return Object.keys(args).length > 0 ? args : undefined;
}

function omitEnvelopeKeys(source: Record<string, unknown>): Record<string, unknown> {
  const { operation: _operation, tool: _tool, idempotency_key: _idempotency, thread: _thread, ...args } = source;
  return args;
}

function omitOperationKeys(source: Record<string, unknown>): Record<string, unknown> {
  const { operation: _operation, tool: _tool, ...args } = source;
  return args;
}

function expectedRequestError(source: Record<string, unknown>, args?: Record<string, unknown>): string {
  const topKeys = Object.keys(source).join(', ') || '(none)';
  const argKeys = args ? Object.keys(args).join(', ') || '(none)' : '(missing)';
  return `Missing required operation. Expected { "operation": "genesis_bootstrap", "arguments": { "workspace_id": "genesis" } }. Received top-level keys: [${topKeys}], argument keys: [${argKeys}]. Legacy alias "tool" is still accepted.`;
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

export function requiredTextArg(value: unknown, name: string, allowEmpty = false): string {
  if (typeof value === 'string' && (allowEmpty || value.length > 0)) return value;
  throw new Error(textArgError(value, name, allowEmpty));
}

function textArgError(value: unknown, name: string, allowEmpty: boolean): string {
  const type = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value;
  const empty = value === '' && !allowEmpty ? ' Empty string is not allowed for this field.' : '';
  const hint = ' If this is structured JSON, serialize it once into a string before sending. Use write_binary_file with base64 for escaping-sensitive exact bytes.';
  return `${name} must be ${allowEmpty ? 'a string' : 'a non-empty string'}; received ${type}.${empty}${hint}`;
}

function requiredNumber(value: unknown, name: string): number {
  const number = optionalNumber(value);
  if (number === undefined) throw new Error(`${name} is required`);
  return number;
}

function optionalStringOrNumber(value: unknown): string | number | undefined {
  return typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value)) ? value : undefined;
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
