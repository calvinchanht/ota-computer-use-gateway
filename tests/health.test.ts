import { describe, expect, it, vi } from 'vitest';
import { healthPayload } from '../src/server/health.js';
import type { AppConfig } from '../src/config/schema.js';

const config: AppConfig = {
  server: {
    host: '127.0.0.1',
    port: 8765,
    auth: { enabled: true, bearer_token_env: 'TEST_BEARER', allow_loopback_without_auth: true },
    rate_limit: { enabled: true, window_ms: 60000, max_requests: 120, trust_proxy_headers: false }
  },
  workspaces: [{ id: 'secret-id', name: 'Secret', root: '/secret/path', allow_read: true, allow_write: false, allow_patch: false, allow_tests: false, allow_screen: false, allow_mouse_keyboard: false, commands: {} }],
  security: { max_file_bytes: 1000, max_response_bytes: 1000, max_request_bytes: 12345, max_search_results: 10, max_exec_ms: 120000, denied_globs: ['secret/**'] }
};

describe('health payload', () => {
  it('exposes readiness without workspace paths or secrets', () => {
    vi.setSystemTime(new Date('2026-01-01T00:00:10Z'));
    const payload = healthPayload(config, new Date('2026-01-01T00:00:00Z').getTime());
    const raw = JSON.stringify(payload);

    expect(payload).toMatchObject({ ok: true, service: 'ota-computer-use-gateway', transport: 'http', mcp_path: '/mcp', uptime_seconds: 10, auth_required: true, rate_limit_enabled: true, max_request_bytes: 12345 });
    expect(raw).not.toContain('/secret/path');
    expect(raw).not.toContain('TEST_BEARER');
  });
});
