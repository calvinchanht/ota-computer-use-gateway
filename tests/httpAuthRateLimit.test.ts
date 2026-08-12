import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import type { AppConfig } from '../src/config/schema.js';
import { createHttpRequestHandler } from '../src/server/http.js';
import { RateLimiter } from '../src/server/rateLimit.js';

const config: AppConfig = {
  server: {
    host: '127.0.0.1', port: 8765,
    auth: { enabled: true, bearer_token_env: 'TEST_BEARER', allow_loopback_without_auth: false },
    rate_limit: { enabled: true, window_ms: 60000, max_requests: 1, trust_proxy_headers: false },
    tool_annotations: { mode: 'honest' }, exposed_tools: []
  },
  workspaces: [],
  security: { max_file_bytes: 1000, max_response_bytes: 1000, max_request_bytes: 10000, max_search_results: 10, max_exec_ms: 120000 }
};

afterEach(() => { delete process.env.TEST_BEARER; });

describe('HTTP auth and rate-limit isolation', () => {
  it('does not let unauthorized requests consume the authenticated request bucket', async () => {
    process.env.TEST_BEARER = 'secret';
    const server = createServer(createHttpRequestHandler(config, new RateLimiter()));
    await listen(server);
    try {
      const base = url(server, '/api/v1/tool');
      const payload = JSON.stringify({ operation: 'workspace_status', arguments: {} });
      for (let index = 0; index < 3; index += 1) {
        const denied = await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json' }, body: payload });
        expect(denied.status).toBe(401);
      }
      const allowed = await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer secret' }, body: payload });
      expect(allowed.status).not.toBe(429);
      const limited = await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer secret' }, body: payload });
      expect(limited.status).toBe(429);
    } finally { await close(server); }
  });
});

function url(server: Server, path: string): string {
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('expected TCP address');
  return `http://127.0.0.1:${address.port}${path}`;
}
async function listen(server: Server): Promise<void> { await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve)); }
async function close(server: Server): Promise<void> { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
