import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { AppConfig } from '../config/schema.js';
import { buildWorkspaces } from '../core/workspaces.js';
import { createServer } from './create.js';
import { assertSafeHttpBind, authError, authStartupWarning, isAuthorized } from './auth.js';
import { healthPayload } from './health.js';
import { auditHttpRequest } from './httpAudit.js';
import { RateLimiter } from './rateLimit.js';
import { installShutdownHooks } from './shutdown.js';

const MCP_PATH = '/mcp';
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
  if (!isMcp(req) && !isApiDebugRequestContext(req)) return sendJson(res, 404, { error: 'not_found' });
  if (!allowedMethod(req.method)) return sendJson(res, 405, { error: 'method_not_allowed' });
  if (!rateLimiter.check(config, req)) return sendJson(res, 429, { error: 'rate_limited' });
  if (requestTooLarge(config, req)) return sendJson(res, 413, { error: 'payload_too_large' });
  if (!isAuthorized(config, req)) return sendAuthError(config, res);
  if (isApiDebugRequestContext(req)) return handleApiDebugRequestContext(req, res);

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

function isApiDebugRequestContext(req: IncomingMessage): boolean {
  return req.url?.split('?')[0] === API_DEBUG_REQUEST_CONTEXT_PATH;
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
