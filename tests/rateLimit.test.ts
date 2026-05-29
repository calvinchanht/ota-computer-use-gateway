import { describe, expect, it } from 'vitest';
import { clientKey, RateLimiter } from '../src/server/rateLimit.js';
import type { AppConfig } from '../src/config/schema.js';

const config: AppConfig = {
  server: {
    host: '127.0.0.1',
    port: 8765,
    auth: { enabled: false, bearer_token_env: 'TEST_BEARER', allow_loopback_without_auth: true },
    rate_limit: { enabled: true, window_ms: 1000, max_requests: 2, trust_proxy_headers: false }
  },
  workspaces: [],
  security: { max_file_bytes: 1000, max_response_bytes: 1000, max_request_bytes: 1000, max_search_results: 10, denied_globs: [] }
};

describe('HTTP rate limiter', () => {
  it('limits requests per client and window', () => {
    const limiter = new RateLimiter();
    expect(limiter.check(config, request('203.0.113.1'), 1000)).toBe(true);
    expect(limiter.check(config, request('203.0.113.1'), 1001)).toBe(true);
    expect(limiter.check(config, request('203.0.113.1'), 1002)).toBe(false);
    expect(limiter.check(config, request('203.0.113.1'), 2101)).toBe(true);
  });

  it('ignores x-forwarded-for by default', () => {
    expect(clientKey(request('127.0.0.1', '198.51.100.7, 198.51.100.8'))).toBe('127.0.0.1');
  });

  it('uses proxy headers only when trusted', () => {
    expect(clientKey(request('127.0.0.1', '198.51.100.7, 198.51.100.8'), true)).toBe('198.51.100.7');
    expect(clientKey(request('127.0.0.1', undefined, '203.0.113.9'), true)).toBe('203.0.113.9');
  });

  it('rate limits by trusted proxy key when configured', () => {
    const trusted = { ...config, server: { ...config.server, rate_limit: { ...config.server.rate_limit, trust_proxy_headers: true } } };
    const limiter = new RateLimiter();
    expect(limiter.check(trusted, request('127.0.0.1', '198.51.100.7'), 1000)).toBe(true);
    expect(limiter.check(trusted, request('127.0.0.1', '198.51.100.8'), 1001)).toBe(true);
    expect(limiter.check(trusted, request('127.0.0.1', '198.51.100.7'), 1002)).toBe(true);
  });
});

function request(remoteAddress: string, forwardedFor?: string, cfConnectingIp?: string) {
  return { headers: { 'x-forwarded-for': forwardedFor, 'cf-connecting-ip': cfConnectingIp }, socket: { remoteAddress } } as never;
}
