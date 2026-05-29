import { describe, expect, it } from 'vitest';
import { assertSafeHttpBind, authStartupWarning, isAuthorized } from '../src/server/auth.js';
import type { AppConfig } from '../src/config/schema.js';

const config: AppConfig = {
  server: { host: '127.0.0.1', port: 8765, rate_limit: { enabled: true, window_ms: 60000, max_requests: 120 }, auth: { enabled: true, bearer_token_env: 'TEST_BEARER', allow_loopback_without_auth: false } },
  workspaces: [],
  security: { max_file_bytes: 1000, max_response_bytes: 1000, max_request_bytes: 1000, max_search_results: 10, denied_globs: [] }
};

describe('HTTP bearer auth', () => {
  it('rejects missing tokens when enabled', () => {
    process.env.TEST_BEARER = 'secret';
    expect(isAuthorized(config, request())).toBe(false);
  });

  it('accepts the configured bearer token', () => {
    process.env.TEST_BEARER = 'secret';
    expect(isAuthorized(config, request('Bearer secret'))).toBe(true);
  });

  it('allows loopback when configured', () => {
    const localConfig = { ...config, server: { ...config.server, auth: { ...config.server.auth, allow_loopback_without_auth: true } } };
    expect(isAuthorized(localConfig, request(undefined, '127.0.0.1'))).toBe(true);
  });

  it('refuses public binds without auth', () => {
    const unsafe = { ...config, server: { ...config.server, host: '0.0.0.0', auth: { ...config.server.auth, enabled: false } } };
    expect(() => assertSafeHttpBind(unsafe)).toThrow('refusing to bind');
  });

  it('warns when auth token env is missing', () => {
    delete process.env.TEST_BEARER;
    expect(authStartupWarning(config)).toContain('TEST_BEARER');
  });
});

function request(authorization?: string, remoteAddress = '203.0.113.10') {
  return { headers: { authorization }, socket: { remoteAddress } } as never;
}
