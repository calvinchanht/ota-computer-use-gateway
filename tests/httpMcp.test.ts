import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../src/config/schema.js';
import { createHttpRequestHandler } from '../src/server/http.js';

const config: AppConfig = {
  server: {
    host: '127.0.0.1',
    port: 8765,
    auth: { enabled: false, bearer_token_env: 'TEST_BEARER', allow_loopback_without_auth: true },
    rate_limit: { enabled: false, window_ms: 60000, max_requests: 120, trust_proxy_headers: false },
    tool_annotations: { mode: 'honest' },
    exposed_tools: []
  },
  workspaces: [],
  security: { max_file_bytes: 1000, max_response_bytes: 1000, max_request_bytes: 10000, max_search_results: 10, max_exec_ms: 120000 }
};

describe('HTTP MCP compatibility transport', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('advertises truthful read-only and destructive annotations in honest mode', async () => {
    vi.stubEnv('OTA_MCP_TRANSPORT_MODE', 'stateless');
    const server = createServer(createHttpRequestHandler(config));
    await listen(server);
    try {
      const response = await mcpRequest(server, { jsonrpc: '2.0', id: 3, method: 'tools/list', params: {} });
      const payload = await mcpPayload(response);
      const tools = new Map((payload.result?.tools ?? []).map((tool: any) => [tool.name, tool]));
      expect(tools.get('read_file')?.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false, openWorldHint: false });
      expect(tools.get('write_file')?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true, openWorldHint: false });
      expect(tools.get('run_command')?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true, openWorldHint: true });
    } finally {
      await close(server);
    }
  });

  it('handles independent stateless requests without a session id', async () => {
    vi.stubEnv('OTA_MCP_TRANSPORT_MODE', 'stateless');
    const server = createServer(createHttpRequestHandler(config));
    await listen(server);
    try {
      const initialize = await mcpRequest(server, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'ota-test', version: '1.0.0' } } });
      const tools = await mcpRequest(server, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
      expect(initialize.status).toBe(200);
      expect(tools.status).toBe(200);
      expect(initialize.headers.get('mcp-session-id')).toBeNull();
      expect(tools.headers.get('mcp-session-id')).toBeNull();
    } finally {
      await close(server);
    }
  });
});

async function mcpPayload(response: Response): Promise<any> {
  const text = await response.text();
  const dataLine = text.split(/\r?\n/).find((line) => line.startsWith('data: '));
  return JSON.parse(dataLine ? dataLine.slice(6) : text);
}

async function mcpRequest(server: Server, body: object): Promise<Response> {
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('expected TCP address');
  return fetch(`http://127.0.0.1:${address.port}/mcp`, {
    method: 'POST',
    headers: { accept: 'application/json, text/event-stream', 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
}

async function listen(server: Server): Promise<void> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
