import { createServer, request as httpRequest, type Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../src/config/schema.js';
import { createHttpRequestHandler } from '../src/server/http.js';

const config: AppConfig = {
  server: {
    host: '127.0.0.1', port: 0,
    auth: { enabled: true, bearer_token_env: 'OTA_SECURITY_TEST_BEARER', allow_loopback_without_auth: false },
    rate_limit: { enabled: false, window_ms: 60000, max_requests: 120, trust_proxy_headers: false },
    tool_annotations: { mode: 'honest' }, exposed_tools: []
  },
  workspaces: [],
  security: { max_file_bytes: 1000, max_response_bytes: 1000, max_request_bytes: 128, max_search_results: 10, max_exec_ms: 120000 }
};

describe('HTTP security boundaries', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('enforces max_request_bytes while streaming chunked authenticated bodies', async () => {
    vi.stubEnv('OTA_SECURITY_TEST_BEARER', 'security-test-token');
    const server = createServer(createHttpRequestHandler(config));
    await listen(server);
    try {
      const response = await rawRequest(server, '/mcp', 'POST', JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'x', arguments: { padding: 'x'.repeat(512) } } }));
      expect(response.status).toBe(413);
      expect(response.body).toMatch(/Payload too large|payload_too_large/i);
      const health = await fetch(baseUrl(server) + '/healthz');
      expect(health.status).toBe(200);
    } finally { await close(server); }
  });

  it('contains malformed encoded API paths and remains healthy', async () => {
    vi.stubEnv('OTA_SECURITY_TEST_BEARER', 'security-test-token');
    const server = createServer(createHttpRequestHandler(config));
    await listen(server);
    try {
      const response = await fetch(baseUrl(server) + '/api/v1/runs/%E0%A4%A', { headers: { authorization: 'Bearer security-test-token' } });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: 'invalid_request_path' });
      expect((await fetch(baseUrl(server) + '/healthz')).status).toBe(200);
    } finally { await close(server); }
  });
});

function rawRequest(server: Server, path: string, method: string, body: string): Promise<{ status: number; body: string }> {
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('expected TCP address');
  return new Promise((resolve, reject) => {
    const req = httpRequest({ hostname: '127.0.0.1', port: address.port, path, method, headers: { authorization: 'Bearer security-test-token', 'content-type': 'application/json' } }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.write(body.slice(0, 80));
    req.write(body.slice(80));
    req.end();
  });
}

function baseUrl(server: Server): string {
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('expected TCP address');
  return `http://127.0.0.1:${address.port}`;
}
async function listen(server: Server): Promise<void> { await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve)); }
async function close(server: Server): Promise<void> { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
