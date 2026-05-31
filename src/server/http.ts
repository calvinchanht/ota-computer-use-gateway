import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { AppConfig } from '../config/schema.js';
import { buildWorkspaces, getWorkspace, type Workspace } from '../core/workspaces.js';
import { audit } from '../core/audit.js';
import { fail, type ToolResult } from '../core/result.js';
import { heartbeat } from '../tools/heartbeat.js';
import { workspaceStatus } from '../tools/workspace.js';
import { listDir, readFileTool } from '../tools/files.js';
import { gitDiff, gitStatus } from '../tools/git.js';
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
    console.error(`Mickey MCP HTTP listening on http://${config.server.host}:${config.server.port}${MCP_PATH}`);
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
  return path === API_DEBUG_REQUEST_CONTEXT_PATH || path === API_TOOL_PATH || path === API_BATCH_PATH;
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
  const request = parseApiToolRequest(parsedBody);
  const result = await runApiTool(config, request.tool, request.arguments ?? {});
  return sendJson(res, 200, { ...result, api: { transport: 'http-json', tool: request.tool, thread: safeBodyThread(parsedBody) } });
}

async function handleApiBatch(config: AppConfig, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'method_not_allowed' });
  const parsedBody = await readJsonBody(req).catch(() => undefined);
  const steps = parseApiBatchRequest(parsedBody).steps.slice(0, 20);
  const results = [];
  for (let index = 0; index < steps.length; index++) {
    const step = steps[index];
    results.push({ index, tool: step.tool, result: await runApiTool(config, step.tool, step.arguments ?? {}) });
  }
  return sendJson(res, 200, { ok: results.every((step) => step.result.ok), summary: `completed ${results.length} API batch steps`, data: { results }, api: { transport: 'http-json', thread: safeBodyThread(parsedBody) } });
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
  if (!workspace) throw new Error('workspace_id is required');
  if (tool === 'list_dir') return listDir(config, workspace, String(args.path ?? '.'), optionalNumber(args.max_entries));
  if (tool === 'read_file') return readFileTool(config, workspace, requiredString(args.path, 'path'), optionalNumber(args.start_line), optionalNumber(args.max_lines));
  if (tool === 'git_status') return gitStatus(workspace);
  if (tool === 'git_diff') return gitDiff(workspace, optionalNumber(args.max_bytes) ?? 20000);
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
  res.setHeader('access-control-allow-headers', 'authorization,content-type,mcp-session-id,mcp-protocol-version,x-openai-conversation-id,x-openai-project-id,x-openai-gpt-id,x-openai-action-invocation-id');
  res.setHeader('access-control-expose-headers', 'mcp-session-id');
}
