import { describe, expect, it } from 'vitest';
import { threaddexProxyErrorBody } from '../src/server/http.js';

describe('Threaddex proxy error diagnostics', () => {
  it('adds actionable non-secret context to upstream job_not_found errors', () => {
    const body = threaddexProxyErrorBody(404, '/v1/job/job_missing/deliver', '{"error":"job_not_found"}');

    expect(body).toMatchObject({
      ok: false,
      error: 'job_not_found',
      proxy: 'threaddex',
      upstream_status: 404,
      upstream_path: '/v1/job/job_missing/deliver'
    });
    expect(String(body.hint)).toContain('job id was not found');
    expect(JSON.stringify(body)).not.toMatch(/bearer|token|secret/i);
  });
});
