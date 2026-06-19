import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { appendFile, mkdir, readFile, stat } from 'node:fs/promises';
import path, { dirname } from 'node:path';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
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
import { githubCliTool } from '../tools/github.js';
import { genesisAgentDeepDive, genesisBootstrap, genesisEstateOverview, genesisHostDeepDive, genesisSafeDiagnostic } from '../tools/genesis.js';
import { agentBootstrap, checkpointThread, contextSnapshot, recordDecision, recordHandoff, recordProgress, updateCurrentTask } from '../tools/context.js';
import { getProjectContext, memoryWrite } from '../tools/memory.js';
import { browserCdpBatch, browserCdpBrowserBatch, browserCdpBrowserCall, browserCdpCall, browserClickAndWait, browserManageTabs, browserUploadFileAndVerify, browserStatus, browserTail, browserVisibleState, listBrowserProfiles, listBrowserTabs } from '../tools/browser.js';
import { computerScreenClick, computerScreenDrag, computerScreenMouseMove, computerScreenScroll, computerWindowClick, computerWindowDrag, computerWindowMouseMove, computerWindowScroll, cuaDriverBatch, cuaDriverCall, cuaDriverStatus, type CuaDriverBatchStep } from '../tools/computer.js';
import {
  windowsBatch,
  windowsClick,
  windowsClipboardGet,
  windowsClipboardSet,
  windowsComputerStatus,
  windowsDoubleClick,
  windowsDrag,
  windowsFocusWindow,
  windowsHotkey,
  windowsKey,
  windowsLaunchApp,
  windowsListMonitors,
  windowsListWindows,
  windowsMouseMove,
  windowsScreenshot,
  windowsScroll,
  windowsTypeText,
  windowsUiaTree,
  windowsWindowClick,
  windowsWindowDoubleClick,
  windowsWindowDrag,
  windowsWindowMouseMove,
  windowsWindowScroll,
  type WindowsBatchStep
} from '../tools/windowsComputer.js';
import { inferFileStructure, jsonProfile, patchFileLines, queryJson, queryTable, queryTableAggregate, readAround, readFileChunk, readFileLinesLarge, sampleFile, searchFile, searchFiles, tableProfile, updateTableRows } from '../tools/largeFiles.js';
import { runArgvTailTool, runArgvTool, runConfiguredCommand } from '../tools/runCommand.js';
import { processKill, processList, processLog, processStart, processStartArgv, processWrite } from '../tools/processes.js';
import { listArtifacts, recordArtifact } from '../tools/artifacts.js';
import { createServer } from './create.js';
import { assertSafeHttpBind, authError, authStartupWarning, isAuthorized } from './auth.js';
import { healthPayload } from './health.js';
import { hasValidArtifactSignature } from './artifactSignatures.js';
import { auditHttpRequest } from './httpAudit.js';
import { RateLimiter } from './rateLimit.js';
import { installShutdownHooks } from './shutdown.js';
import { brokeredExecutorStore } from '../brokeredExecutor/store.js';
import { brokeredExecutorEnabled, enabledExecutor } from '../brokeredExecutor/config.js';
import { completeExecutorJobSchema, executorClaimSchema, executorHeartbeatSchema, submitExecutorJobSchema } from '../brokeredExecutor/types.js';

const MCP_PATH = '/mcp';
const API_TOOL_PATH = '/api/v1/tool';
const API_GITHUB_PATHS = new Set(['/api/v1/github', '/api/v1/gh']);
const API_BATCH_PATH = '/api/v1/batch';
const API_DEBUG_REQUEST_CONTEXT_PATH = '/api/v1/debug/request_context';
const API_RUNS_PREFIX = '/api/v1/runs/';
const API_ARTIFACTS_PREFIX = '/api/v1/artifacts/';
const API_EXECUTOR_JOBS_PREFIX = '/api/v1/executor-jobs';
const API_EXECUTORS_PREFIX = '/api/v1/executors';
const OTA_PATH_PREFIX = '/ota';
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

  const httpServer = createHttpServer(createHttpRequestHandler(config, rateLimiter, startedAt, auditWorkspace));

  installShutdownHooks(httpServer);
  httpServer.listen(config.server.port, config.server.host, () => {
    console.error(`OTA gateway HTTP API listening on http://${config.server.host}:${config.server.port}/api/v1/tool; compatibility transport at ${MCP_PATH}`);
  });
}

export function createHttpRequestHandler(config: AppConfig, rateLimiter = new RateLimiter(), startedAt = Date.now(), auditWorkspace: Workspace | null = null) {
  return (req: IncomingMessage, res: ServerResponse) => {
    auditHttpRequest(auditWorkspace, req, res);
    void handleRequest(config, rateLimiter, startedAt, req, res);
  };
}

async function handleRequest(config: AppConfig, rateLimiter: RateLimiter, startedAt: number, req: IncomingMessage, res: ServerResponse) {
  stripOtaPathPrefix(req);
  if (isHealth(req)) return sendJson(res, 200, healthPayload(config, startedAt));
  if (req.method === 'OPTIONS') return sendCors(res);
  if (!isMcp(req) && !isApi(req)) return sendJson(res, 404, { error: 'not_found' });
  if (!allowedMethod(req.method)) return sendJson(res, 405, { error: 'method_not_allowed' });
  if (!rateLimiter.check(config, req)) return sendJson(res, 429, { error: 'rate_limited' });
  if (requestTooLarge(config, req)) return sendJson(res, 413, { error: 'payload_too_large' });
  const signedArtifact = isApiArtifactPath(req) && hasValidArtifactSignature(req);
  if (!signedArtifact && !isAuthorized(config, req) && !isBrokeredExecutorWorkerRequestAuthorized(config, req)) return sendAuthError(config, res);
  if (isApiDebugRequestContext(req)) return handleApiDebugRequestContext(req, res);
  if (isBrokeredExecutorPath(req)) return handleBrokeredExecutorApi(config, req, res);
  if (isApiArtifactPath(req)) return handleApiArtifact(config, req, res);
  if (isApiRunPath(req)) return handleApiRun(req, res);
  if (isApiGithub(req)) return handleApiGithub(config, req, res);
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
  return path === API_DEBUG_REQUEST_CONTEXT_PATH || path === API_TOOL_PATH || API_GITHUB_PATHS.has(path ?? '') || path === API_BATCH_PATH || isApiRunPath(req) || isApiArtifactPath(req) || isBrokeredExecutorPath(req);
}

function isApiArtifactPath(req: IncomingMessage): boolean {
  return req.url?.split('?')[0]?.startsWith(API_ARTIFACTS_PREFIX) ?? false;
}

function isBrokeredExecutorPath(req: IncomingMessage): boolean {
  const path = req.url?.split('?')[0] ?? '';
  return path === API_EXECUTOR_JOBS_PREFIX || path.startsWith(`${API_EXECUTOR_JOBS_PREFIX}/`) || path.startsWith(`${API_EXECUTORS_PREFIX}/`);
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

function isApiGithub(req: IncomingMessage): boolean {
  return API_GITHUB_PATHS.has(req.url?.split('?')[0] ?? '');
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


async function handleApiTool(config: AppConfig, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'method_not_allowed' });
  const parsed = await readApiJsonBody(req);
  if (!parsed.ok) return sendJson(res, parsed.status, { ok: false, error: parsed.error });
  const parsedBody = parsed.body;
  const idempotencyKey = idempotencyKeyFor(req, parsedBody);
  const existing = existingRun(idempotencyKey);
  if (existing) return sendJson(res, 200, existing.response);
  const request = parseApiToolRequestSafe(parsedBody);
  if (!request.ok) { reportApiShapeMisuse(config, req, parsedBody, request.body, 'ota.api_tool_request.v1', 'use_operation_arguments_shape'); return sendJson(res, request.status, request.body); }
  const args = request.value.arguments ?? {};
  if (shouldUseQuotaSaver(request.value.tool, args)) return handleQuotaSaverApiTool(config, res, request.value.tool, args, idempotencyKey, safeBodyThread(parsedBody));
  const result = await runApiTool(config, request.value.tool, args);
  const response = { ...result, api: { transport: 'http-json', tool: request.value.tool, thread: safeBodyThread(parsedBody) } };
  const record = storeApiRun({ kind: 'tool', ok: result.ok, summary: result.summary, response, idempotency_key: idempotencyKey, request: { tool: request.value.tool, thread: safeBodyThread(parsedBody) } });
  return sendJson(res, 200, attachRun(response, record));
}

async function handleApiGithub(config: AppConfig, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'method_not_allowed' });
  const parsed = await readApiJsonBody(req);
  if (!parsed.ok) return sendJson(res, parsed.status, { ok: false, error: parsed.error });
  const args = recordArg(parsed.body, 'github request') ?? {};
  const idempotencyKey = idempotencyKeyFor(req, parsed.body);
  const existing = existingRun(idempotencyKey);
  if (existing) return sendJson(res, 200, existing.response);
  if (shouldUseQuotaSaver('github', args)) return handleQuotaSaverApiTool(config, res, 'github', args, idempotencyKey, safeBodyThread(parsed.body));
  const result = await runApiTool(config, 'github', args);
  const response = { ...result, api: { transport: 'http-json', tool: 'github', path_alias: req.url?.split('?')[0], thread: safeBodyThread(parsed.body) } };
  const record = storeApiRun({ kind: 'tool', ok: result.ok, summary: result.summary, response, idempotency_key: idempotencyKey, request: { tool: 'github', thread: safeBodyThread(parsed.body) } });
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
  if (!parsedBatch.ok) { reportApiShapeMisuse(config, req, parsedBody, parsedBatch.body, 'ota.api_batch_request.v1', 'use_steps_array'); return sendJson(res, parsedBatch.status, parsedBatch.body); }
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



function isBrokeredExecutorWorkerRequestAuthorized(config: AppConfig, req: IncomingMessage): boolean {
  const path = req.url?.split('?')[0] ?? '';
  if (!path.startsWith(`${API_EXECUTORS_PREFIX}/`)) return false;
  const rest = path.slice(`${API_EXECUTORS_PREFIX}/`.length);
  const parts = rest.split('/').map((part) => decodeURIComponent(part));
  const executorId = parts[0];
  if (!executorId) return false;
  const isWorkerRoute = (parts.length === 2 && (parts[1] === 'heartbeat' || parts[1] === 'claim')) || (parts.length === 4 && parts[1] === 'jobs' && (parts[3] === 'complete' || parts[3] === 'fail'));
  if (!isWorkerRoute) return false;
  const executor = enabledExecutor(config, executorId);
  const envName = executor?.worker_bearer_token_env;
  const expected = envName ? process.env[envName] : undefined;
  return Boolean(expected && bearerTokenMatches(req, expected));
}

async function handleBrokeredExecutorApi(config: AppConfig, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!brokeredExecutorEnabled(config)) return sendJson(res, 404, { ok: false, error: 'brokered_executors_disabled', summary: 'brokered executor stack is disabled' });
  const path = req.url?.split('?')[0] ?? '';
  try {
    if (path === API_EXECUTOR_JOBS_PREFIX && req.method === 'POST') {
      const parsed = await readApiJsonBody(req);
      if (!parsed.ok) return sendJson(res, parsed.status, { ok: false, error: parsed.error });
      const input = submitExecutorJobSchema.parse(parsed.body);
      const job = brokeredExecutorStore.submit(config, input);
      return sendJson(res, 200, { ok: true, summary: 'brokered executor job submitted', job });
    }

    if (path.startsWith(`${API_EXECUTOR_JOBS_PREFIX}/`) && req.method === 'GET') {
      const rest = path.slice(`${API_EXECUTOR_JOBS_PREFIX}/`.length);
      const resultOnly = rest.endsWith('/result');
      const jobId = decodeURIComponent(resultOnly ? rest.slice(0, -'/result'.length) : rest);
      const job = brokeredExecutorStore.get(jobId);
      if (!job) return sendJson(res, 404, { ok: false, error: 'brokered_executor_job_not_found', broker_job_id: jobId });
      if (resultOnly) return sendJson(res, 200, { ok: true, summary: 'brokered executor job result', broker_job_id: job.broker_job_id, state: job.state, result: job.result, artifacts: job.artifacts, error_code: job.error_code, error_message: job.error_message });
      return sendJson(res, 200, { ok: true, summary: 'brokered executor job status', job });
    }

    if (path.startsWith(`${API_EXECUTORS_PREFIX}/`) && req.method === 'POST') return await handleBrokeredExecutorWorkerApi(config, req, res, path);
    return sendJson(res, 404, { ok: false, error: 'brokered_executor_route_not_found' });
  } catch (error) {
    const body = brokeredExecutorErrorBody(error);
    return sendJson(res, body.status, body.body);
  }
}

async function handleBrokeredExecutorWorkerApi(config: AppConfig, req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
  const rest = path.slice(`${API_EXECUTORS_PREFIX}/`.length);
  const parts = rest.split('/').map((part) => decodeURIComponent(part));
  const executorId = parts[0];
  if (!executorId) return sendJson(res, 400, { ok: false, error: 'executor_id_required' });
  const auth = brokeredExecutorWorkerAuth(config, executorId, req);
  if (!auth.ok) return sendJson(res, auth.status, auth.body);
  const parsed = await readApiJsonBody(req);
  if (!parsed.ok) return sendJson(res, parsed.status, { ok: false, error: parsed.error });
  const body = parsed.body && typeof parsed.body === 'object' ? parsed.body as Record<string, unknown> : {};
  const withExecutorId = { ...body, executor_id: body.executor_id ?? executorId };

  if (parts.length === 2 && parts[1] === 'heartbeat') {
    const input = executorHeartbeatSchema.parse(withExecutorId);
    const heartbeat = brokeredExecutorStore.heartbeat(input);
    return sendJson(res, 200, { ok: true, summary: 'brokered executor heartbeat recorded', heartbeat });
  }

  if (parts.length === 2 && parts[1] === 'claim') {
    const input = executorClaimSchema.parse(withExecutorId);
    const job = brokeredExecutorStore.claim(config, input);
    return sendJson(res, 200, job ? { ok: true, summary: 'brokered executor job claimed', job } : { ok: true, summary: 'no brokered executor job available', no_job: true });
  }

  if (parts.length === 4 && parts[1] === 'jobs' && (parts[3] === 'complete' || parts[3] === 'fail')) {
    const input = completeExecutorJobSchema.parse(withExecutorId);
    const job = brokeredExecutorStore.complete(parts[2], input);
    return sendJson(res, 200, { ok: true, summary: `brokered executor job ${input.result.status}`, job });
  }

  return sendJson(res, 404, { ok: false, error: 'brokered_executor_worker_route_not_found' });
}


function brokeredExecutorWorkerAuth(config: AppConfig, executorId: string, req: IncomingMessage): { ok: true } | { ok: false; status: number; body: Record<string, unknown> } {
  const executor = enabledExecutor(config, executorId);
  if (!executor) return { ok: false, status: 404, body: { ok: false, error: 'executor_offline', error_code: 'executor_offline', message: 'brokered executor is disabled or unknown' } };
  const envName = executor.worker_bearer_token_env;
  if (!envName) return { ok: true };
  const expected = process.env[envName];
  if (!expected) return { ok: false, status: 401, body: { ok: false, error: 'executor_auth_missing', error_code: 'executor_auth_missing', message: `missing ${envName}` } };
  if (!bearerTokenMatches(req, expected)) return { ok: false, status: 401, body: { ok: false, error: 'executor_unauthorized', error_code: 'executor_unauthorized', message: 'invalid executor bearer token' } };
  return { ok: true };
}

function bearerTokenMatches(req: IncomingMessage, expected: string): boolean {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return false;
  const actual = header.slice('Bearer '.length);
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function brokeredExecutorErrorBody(error: unknown): { status: number; body: Record<string, unknown> } {
  const message = error instanceof Error ? error.message : String(error);
  const code = error && typeof error === 'object' && 'code' in error && typeof (error as { code?: unknown }).code === 'string' ? (error as { code: string }).code : 'invalid_arguments';
  const status = code === 'executor_offline' ? 404 : code === 'operation_not_allowed' ? 403 : code === 'lease_expired' ? 409 : 400;
  return { status, body: { ok: false, error: code, error_code: code, message } };
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
  if (tool === 'run_command' || tool === 'search_files' || tool === 'github') return true;
  if (tool === 'cua_driver_status') return false;
  return tool.startsWith('browser_cdp') || tool.startsWith('cua_driver_') || tool.startsWith('computer_');
}

function initialWaitReason(tool: string): string {
  if (tool.startsWith('browser_cdp')) return 'waiting_for_browser';
  if (tool.startsWith('cua_driver') || tool.startsWith('computer_')) return 'waiting_for_computer';
  if (tool === 'search_files') return 'searching_workspace';
  if (tool === 'run_command') return 'running_command';
  if (tool === 'github') return 'running_github_command';
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
    await reportToolMisuse(config, tool, args, summary);
    await audit(workspace, { timestamp: new Date().toISOString(), tool: `api:${tool}`, ok: false, summary, duration_ms: Date.now() - started });
    return fail(summary);
  }
}

async function callApiTool(config: AppConfig, workspaces: Awaited<ReturnType<typeof buildWorkspaces>>, workspace: Workspace | null, tool: string, args: Record<string, unknown>): Promise<ToolResult> {
  if (tool === 'heartbeat') return heartbeat(workspaces);
  if (tool === 'workspace_status') return workspaceStatus(workspaces);
  if (tool === 'get_tool_profile') return toolProfile(config);
  if (!workspace) throw new Error('workspace_id is required');
  if (tool === 'get_workspace_policy') return workspacePolicy(workspace, config);
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
  if (tool === 'github') return githubCliTool(config, workspace, runCommandCmdArray(args), optionalString(args.cwd) ?? '.', optionalNumber(args.timeout_ms) ?? 60000, optionalNumber(args.max_output_chars) ?? optionalNumber(args.max_stdout_bytes) ?? 20000);
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
  if (tool === 'windows_computer_status') return windowsComputerStatus(workspace);
  if (tool === 'windows_list_monitors') return windowsListMonitors(workspace);
  if (tool === 'windows_list_windows') return windowsListWindows(workspace);
  if (tool === 'windows_screenshot') return windowsScreenshot(workspace, optionalString(args.monitor) ?? 'primary', windowsScreenshotParams(args));
  if (tool === 'windows_uia_tree') return windowsUiaTree(workspace, optionalNumber(args.max_nodes) ?? 120);
  if (tool === 'windows_focus_window') return windowsFocusWindow(workspace, requiredNumber(args.hwnd, 'hwnd'));
  if (tool === 'windows_launch_app') return windowsLaunchApp(workspace, requiredString(args.file_path, 'file_path'), optionalStringArray(args.args), optionalString(args.cwd));
  if (tool === 'windows_mouse_move') return windowsMouseMove(workspace, requiredNumber(args.x, 'x'), requiredNumber(args.y, 'y'));
  if (tool === 'windows_click') return windowsClick(workspace, requiredNumber(args.x, 'x'), requiredNumber(args.y, 'y'), optionalString(args.button) ?? 'left');
  if (tool === 'windows_double_click') return windowsDoubleClick(workspace, requiredNumber(args.x, 'x'), requiredNumber(args.y, 'y'), optionalString(args.button) ?? 'left');
  if (tool === 'windows_drag') return windowsDrag(workspace, requiredNumber(args.from_x, 'from_x'), requiredNumber(args.from_y, 'from_y'), requiredNumber(args.to_x, 'to_x'), requiredNumber(args.to_y, 'to_y'));
  if (tool === 'windows_scroll') return windowsScroll(workspace, requiredNumber(args.x, 'x'), requiredNumber(args.y, 'y'), requiredNumber(args.delta, 'delta'));
  if (tool === 'windows_window_mouse_move') return windowsWindowMouseMove(workspace, requiredNumber(args.hwnd, 'hwnd'), requiredNumber(args.x, 'x'), requiredNumber(args.y, 'y'), optionalString(args.coordinate_space) ?? 'client', optionalBoolean(args.focus) ?? false);
  if (tool === 'windows_window_click') return windowsWindowClick(workspace, requiredNumber(args.hwnd, 'hwnd'), requiredNumber(args.x, 'x'), requiredNumber(args.y, 'y'), optionalString(args.button) ?? 'left', optionalString(args.coordinate_space) ?? 'client', optionalBoolean(args.focus) ?? true);
  if (tool === 'windows_window_double_click') return windowsWindowDoubleClick(workspace, requiredNumber(args.hwnd, 'hwnd'), requiredNumber(args.x, 'x'), requiredNumber(args.y, 'y'), optionalString(args.button) ?? 'left', optionalString(args.coordinate_space) ?? 'client', optionalBoolean(args.focus) ?? true);
  if (tool === 'windows_window_drag') return windowsWindowDrag(workspace, requiredNumber(args.hwnd, 'hwnd'), requiredNumber(args.from_x, 'from_x'), requiredNumber(args.from_y, 'from_y'), requiredNumber(args.to_x, 'to_x'), requiredNumber(args.to_y, 'to_y'), optionalString(args.coordinate_space) ?? 'client', optionalBoolean(args.focus) ?? true);
  if (tool === 'windows_window_scroll') return windowsWindowScroll(workspace, requiredNumber(args.hwnd, 'hwnd'), requiredNumber(args.x, 'x'), requiredNumber(args.y, 'y'), requiredNumber(args.delta, 'delta'), optionalString(args.coordinate_space) ?? 'client', optionalBoolean(args.focus) ?? true);
  if (tool === 'windows_type_text') return windowsTypeText(workspace, requiredString(args.text, 'text'));
  if (tool === 'windows_key') return windowsKey(workspace, requiredString(args.key, 'key'));
  if (tool === 'windows_hotkey') return windowsHotkey(workspace, requiredStringArray(args.keys, 'keys'));
  if (tool === 'windows_clipboard_get') return windowsClipboardGet(workspace);
  if (tool === 'windows_clipboard_set') return windowsClipboardSet(workspace, requiredTextArg(args.text, 'text', true));
  if (tool === 'windows_batch') return windowsBatch(workspace, requiredWindowsBatchSteps(args.calls));
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
  if (tool === 'start_process') return startProcessFromArgs(config, workspace, args);
  if (tool === 'list_processes') return processList();
  if (tool === 'read_process') return processLog(requiredString(args.process_id, 'process_id'), optionalNumber(args.max_bytes) ?? 50000, optionalNumber(args.cursor));
  if (tool === 'write_process') return processWrite(requiredString(args.process_id, 'process_id'), requiredString(args.input, 'input'), Boolean(args.close_stdin));
  if (tool === 'stop_process') return processKill(requiredString(args.process_id, 'process_id'));
  if (tool === 'run_command' && Boolean(args.tail)) return runArgvTailTool(config, workspace, runCommandCmdArray(args), optionalString(args.cwd) ?? '.', optionalNumber(args.timeout_ms) ?? 30000);
  if (tool === 'run_command') return runArgvTool(config, workspace, runCommandCmdArray(args), optionalString(args.cwd) ?? '.', optionalNumber(args.timeout_ms) ?? 30000, optionalNumber(args.max_stdout_bytes) ?? 20000, optionalNumber(args.max_stderr_bytes) ?? 8000);
  if (tool === 'run_configured_command') return runConfiguredCommand(config, workspace, requiredString(args.command_id, 'command_id'));
  throw new Error(`unsupported API tool: ${tool}`);
}


function toolExposureError(tool: string): string {
  if (tool === 'deliverJob') return 'tool is not exposed by the OTA capability gateway. Use the Threaddex Job API path on the same agent host, for example /threaddex/v1/job/{job_id}/deliver.';
  if (tool === 'deliverJobProgress') return 'tool is not exposed by the OTA capability gateway. Use the Threaddex Job API path on the same agent host, for example /threaddex/v1/job/{job_id}/progress.';
  if (tool === 'getJob') return 'tool is not exposed by the OTA capability gateway. Use the Threaddex Job API path on the same agent host, for example /threaddex/v1/job/{job_id}.';
  return `tool is not exposed by this workspace api_sets profile: ${tool}`;
}

type ApiToolRequest = { tool: string; arguments?: Record<string, unknown> };
type ApiShapeErrorBody = { ok: false; error: string; error_code: string; message: string; expected?: unknown; accepted_aliases?: Record<string, string>; received_top_level_keys?: string[]; received_argument_keys?: string[]; hint?: string };

class ApiShapeError extends Error {
  constructor(readonly body: ApiShapeErrorBody) {
    super(body.message);
  }
}

export function parseApiToolRequestSafe(body: unknown): { ok: true; value: ApiToolRequest } | { ok: false; status: number; body: ApiShapeErrorBody } {
  try {
    return { ok: true, value: parseApiToolRequest(body) };
  } catch (error) {
    return { ok: false, status: 400, body: apiShapeErrorBody(error) };
  }
}

function parseApiBatchRequestSafe(body: unknown): { ok: true; value: { steps: ApiToolRequest[] } } | { ok: false; status: number; body: ApiShapeErrorBody } {
  try {
    return { ok: true, value: parseApiBatchRequest(body) };
  } catch (error) {
    return { ok: false, status: 400, body: apiShapeErrorBody(error) };
  }
}

function apiShapeErrorBody(error: unknown): ApiShapeErrorBody {
  if (error instanceof ApiShapeError) return error.body;
  const message = error instanceof Error ? error.message : String(error);
  return { ok: false, error: 'invalid_gateway_request_shape', error_code: 'invalid_gateway_request_shape', message };
}

export function parseApiToolRequest(body: unknown): ApiToolRequest {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('JSON object body is required');
  const source = body as Record<string, unknown>;
  const topOperation = requestOperation(source.operation, source.tool);
  const args = requestArguments(source);
  const nestedOperation = !topOperation && args ? requestOperation(args.operation, args.tool) : undefined;
  const operation = topOperation ?? nestedOperation;
  if (!operation) throw expectedRequestError(source, args);
  const normalizedArgs = nestedOperation && args ? omitOperationKeys(args) : args;
  return { tool: operation, arguments: normalizedArgs };
}

function parseApiBatchRequest(body: unknown): { steps: ApiToolRequest[] } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('JSON object body is required');
  const steps = (body as Record<string, unknown>).steps;
  if (!Array.isArray(steps)) throw expectedBatchRequestError(body as Record<string, unknown>);
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
  const args = { ...source };
  delete args.operation;
  delete args.tool;
  delete args.idempotency_key;
  delete args.thread;
  return args;
}

function omitOperationKeys(source: Record<string, unknown>): Record<string, unknown> {
  const args = { ...source };
  delete args.operation;
  delete args.tool;
  return args;
}

function expectedRequestError(source: Record<string, unknown>, args?: Record<string, unknown>): ApiShapeError {
  const topKeys = Object.keys(source);
  const argKeys = args ? Object.keys(args) : [];
  const message = `Missing required operation. Expected { "operation": "genesis_bootstrap", "arguments": { "workspace_id": "genesis" } }. Received top-level keys: [${topKeys.join(', ') || '(none)'}], argument keys: [${args ? argKeys.join(', ') || '(none)' : '(missing)'}]. Legacy alias "tool" is still accepted.`;
  return new ApiShapeError({
    ok: false,
    error: 'invalid_gateway_request_shape',
    error_code: 'invalid_gateway_request_shape',
    message,
    expected: { operation: 'genesis_bootstrap', arguments: { workspace_id: 'genesis' } },
    accepted_aliases: { tool: 'legacy alias for operation' },
    received_top_level_keys: topKeys,
    received_argument_keys: argKeys,
    hint: 'Put the operation name at top level and workspace_id inside arguments.'
  });
}

function expectedBatchRequestError(source: Record<string, unknown>): ApiShapeError {
  return new ApiShapeError({
    ok: false,
    error: 'invalid_gateway_request_shape',
    error_code: 'invalid_gateway_request_shape',
    message: 'steps must be an array',
    expected: { steps: [{ operation: 'heartbeat', arguments: { workspace_id: 'genesis' } }] },
    accepted_aliases: { tool: 'legacy alias for operation inside each step' },
    received_top_level_keys: Object.keys(source),
    hint: 'Send steps as an array of { operation, arguments } objects.'
  });
}

function recordArg(value: unknown, name: string): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} must be an object`);
  return value as Record<string, unknown>;
}

function windowsScreenshotParams(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (args.visual_followup !== undefined) out.visual_followup = recordArg(args.visual_followup, 'visual_followup');
  for (const key of ['job_id', 'threaddex_job_id', 'threaddex_base_url']) {
    if (typeof args[key] === 'string') out[key] = args[key];
  }
  return out;
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

function requiredWindowsBatchSteps(value: unknown): WindowsBatchStep[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error('calls array is required');
  return value as WindowsBatchStep[];
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

async function startProcessFromArgs(config: AppConfig, workspace: Workspace, args: Record<string, unknown>): Promise<ToolResult> {
  const preferred = args.cmd_array;
  const legacyCommand = args.command;
  if (preferred !== undefined && legacyCommand !== undefined) throw new Error('start_process cmd_array/command conflict: prefer cmd_array and remove legacy command.');
  if (preferred !== undefined) return processStartArgv(config, workspace, requiredStringArray(preferred, 'cmd_array'), optionalString(args.cwd) ?? '.', optionalNumber(args.timeout_ms) ?? 30000);
  if (legacyCommand !== undefined) return processStart(config, workspace, requiredString(legacyCommand, 'command'));
  throw new Error('cmd_array must be an array');
}

export function runCommandCmdArray(args: Record<string, unknown>): string[] {
  const preferred = args.cmd_array;
  const legacy = args.cmd;
  if (typeof legacy === 'string') throw new Error('cmd must be an array. Use cmd_array: ["git", "status", "--short"]. If shell behavior is intentional, call get_tool_profile or get_workspace_policy and use command_runtime.recommended_cmd_array_for_shell.');
  if (preferred !== undefined && legacy !== undefined) {
    const preferredArray = requiredStringArray(preferred, 'cmd_array');
    const legacyArray = requiredStringArray(legacy, 'cmd');
    if (JSON.stringify(preferredArray) !== JSON.stringify(legacyArray)) throw new Error('cmd_array/cmd conflict: prefer cmd_array and remove legacy cmd, or send identical arrays for compatibility.');
    return preferredArray;
  }
  if (preferred !== undefined) return requiredStringArray(preferred, 'cmd_array');
  return requiredStringArray(legacy, 'cmd_array');
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

function reportApiShapeMisuse(config: AppConfig, req: IncomingMessage, body: unknown, error: ApiShapeErrorBody, expectedShapeId: string, hintId: string): void {
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

async function reportToolMisuse(config: AppConfig, tool: string, args: Record<string, unknown>, summary: string): Promise<void> {
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
  if (isJobLifecycleMisuse(tool, summary)) return {
    workspace_id: stringField(args.workspace_id), operation: tool, error_code: 'blocked_job_lifecycle_via_ota',
    received_argument_keys: Object.keys(args).sort(), bad_field: 'operation', bad_field_type: 'string',
    expected_shape_id: 'threaddex.native_job_lifecycle.v1', hint_id: 'use_native_threaddex_job_api_actions'
  };
  return null;
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
  if (summary.includes('cmd must be an array')) return {
    ...fieldMisuse(tool, args, 'cmd', 'run_command.argv.v1', 'use_cmd_array'),
    error_code: 'invalid_run_command_shape'
  };
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
    if (!matchesFieldError(summary, spec.field)) continue;
    return fieldMisuse(tool, args, spec.field, spec.expected_shape_id, spec.hint_id);
  }
  return null;
}

type CommonToolShapeSpec = { field: string; expected_shape_id: string; hint_id: string };

function commonToolShapeSpecs(tool: string): CommonToolShapeSpec[] {
  const specs: CommonToolShapeSpec[] = [];
  if (pathStringTools().has(tool)) specs.push({ field: 'path', expected_shape_id: 'filesystem.path_string.v1', hint_id: 'use_path_string' });
  if (queryStringTools().has(tool)) specs.push({ field: 'query', expected_shape_id: `${tool}.query_string.v1`, hint_id: 'use_query_string' });
  if (targetIdTools().has(tool)) specs.push({ field: 'target_id', expected_shape_id: 'browser.target_id_string.v1', hint_id: 'use_target_id_string' });
  if (methodStringTools().has(tool)) specs.push({ field: 'method', expected_shape_id: `${tool}.method_string.v1`, hint_id: 'use_method_string' });
  if (paramsObjectTools().has(tool)) specs.push({ field: 'params', expected_shape_id: `${tool}.params_object.v1`, hint_id: 'use_params_object' });
  if (commandStringTools().has(tool)) specs.push({ field: 'command', expected_shape_id: `${tool}.command_string.v1`, hint_id: 'use_command_string' });
  if (processIdStringTools().has(tool)) specs.push({ field: 'process_id', expected_shape_id: 'process.process_id_string.v1', hint_id: 'use_process_id_string' });
  if (arrayFieldSpec(tool, 'columns')) specs.push(arrayFieldSpec(tool, 'columns')!);
  if (arrayFieldSpec(tool, 'select')) specs.push(arrayFieldSpec(tool, 'select')!);
  if (arrayFieldSpec(tool, 'group_by')) specs.push(arrayFieldSpec(tool, 'group_by')!);
  if (arrayFieldSpec(tool, 'sort')) specs.push(arrayFieldSpec(tool, 'sort')!);
  if (arrayFieldSpec(tool, 'metrics')) specs.push(arrayFieldSpec(tool, 'metrics')!);
  if (objectFieldSpec(tool, 'where')) specs.push(objectFieldSpec(tool, 'where')!);
  if (objectFieldSpec(tool, 'set')) specs.push(objectFieldSpec(tool, 'set')!);
  if (tool === 'write_process') specs.push({ field: 'input', expected_shape_id: 'write_process.input_string.v1', hint_id: 'use_input_string' });
  if (tool === 'patch_file_lines') specs.push({ field: 'replacement', expected_shape_id: 'patch_file_lines.replacement_string.v1', hint_id: 'use_replacement_string' });
  if (tool === 'write_file') specs.push({ field: 'content', expected_shape_id: 'write_file.content_string.v1', hint_id: 'use_content_string' });
  if (tool === 'write_binary_file') specs.push({ field: 'base64', expected_shape_id: 'write_binary_file.base64_string.v1', hint_id: 'use_base64_string' });
  if (tool === 'edit_file') specs.push({ field: 'old_text', expected_shape_id: 'edit_file.old_text_string.v1', hint_id: 'use_old_text_string' }, { field: 'new_text', expected_shape_id: 'edit_file.new_text_string.v1', hint_id: 'use_new_text_string' });
  return specs;
}

function arrayFieldSpec(tool: string, field: string): CommonToolShapeSpec | null {
  const arrayFields: Record<string, Set<string>> = {
    columns: new Set(['table_profile']),
    select: new Set(['query_table']),
    group_by: new Set(['query_table_aggregate']),
    sort: new Set(['query_table']),
    metrics: new Set(['query_table_aggregate'])
  };
  if (!arrayFields[field]?.has(tool)) return null;
  return { field, expected_shape_id: `${tool}.${field}_array.v1`, hint_id: `use_${field}_array` };
}

function objectFieldSpec(tool: string, field: string): CommonToolShapeSpec | null {
  const objectFields: Record<string, Set<string>> = {
    where: new Set(['query_table', 'query_table_aggregate', 'update_table_rows']),
    set: new Set(['update_table_rows'])
  };
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

function commandStringTools(): Set<string> {
  return new Set([]);
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
  await appendFile(file, `${JSON.stringify(event)}
`, 'utf8');
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
