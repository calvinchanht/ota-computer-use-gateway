import { describe, expect, it } from 'vitest';
import { requestTooLarge } from '../src/server/http.js';
import type { AppConfig } from '../src/config/schema.js';

const config: AppConfig = {
  server: { host: '127.0.0.1', port: 8765, auth: { enabled: false, bearer_token_env: 'TEST_BEARER', allow_loopback_without_auth: true } },
  workspaces: [],
  security: { max_file_bytes: 1000, max_response_bytes: 1000, max_request_bytes: 100, max_search_results: 10, denied_globs: [] }
};

describe('HTTP request limits', () => {
  it('accepts requests below the configured content-length limit', () => {
    expect(requestTooLarge(config, request('99'))).toBe(false);
  });

  it('rejects requests above the configured content-length limit', () => {
    expect(requestTooLarge(config, request('101'))).toBe(true);
  });

  it('ignores missing or invalid content-length values', () => {
    expect(requestTooLarge(config, request())).toBe(false);
    expect(requestTooLarge(config, request('not-a-number'))).toBe(false);
  });
});

function request(contentLength?: string) {
  return { headers: { 'content-length': contentLength } } as never;
}
