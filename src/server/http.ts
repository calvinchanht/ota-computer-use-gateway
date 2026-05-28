import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { AppConfig } from '../config/schema.js';
import { createServer } from './create.js';
import { authError, isAuthorized } from './auth.js';

const MCP_PATH = '/mcp';

export async function listenHttp(config: AppConfig): Promise<void> {
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID() });
  const mcpServer = await createServer(config);
  await mcpServer.connect(transport);

  const httpServer = createHttpServer((req, res) => {
    void handleRequest(config, transport, req, res);
  });

  httpServer.listen(config.server.port, config.server.host, () => {
    console.error(`Mickey MCP HTTP listening on http://${config.server.host}:${config.server.port}${MCP_PATH}`);
  });
}

async function handleRequest(config: AppConfig, transport: StreamableHTTPServerTransport, req: IncomingMessage, res: ServerResponse) {
  if (isHealth(req)) return sendJson(res, 200, { ok: true });
  if (!isMcp(req)) return sendJson(res, 404, { error: 'not_found' });
  if (req.method === 'OPTIONS') return sendCors(res);
  if (!allowedMethod(req.method)) return sendJson(res, 405, { error: 'method_not_allowed' });
  if (!isAuthorized(config, req)) return sendAuthError(config, res);

  applyCors(res);
  await transport.handleRequest(req, res);
}

function isHealth(req: IncomingMessage): boolean {
  return req.url === '/healthz' && req.method === 'GET';
}

function isMcp(req: IncomingMessage): boolean {
  return req.url?.startsWith(MCP_PATH) ?? false;
}

function allowedMethod(method: string | undefined): boolean {
  return method === 'GET' || method === 'POST' || method === 'DELETE';
}

function sendCors(res: ServerResponse): void {
  applyCors(res);
  res.writeHead(204).end();
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  applyCors(res);
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
}

function sendAuthError(config: AppConfig, res: ServerResponse): void {
  res.setHeader('www-authenticate', 'Bearer');
  sendJson(res, 401, authError(config));
}

function applyCors(res: ServerResponse): void {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('access-control-allow-headers', 'authorization,content-type,mcp-session-id,mcp-protocol-version');
  res.setHeader('access-control-expose-headers', 'mcp-session-id');
}
