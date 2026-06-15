import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Workspace } from '../src/core/workspaces.js';
import { threaddexDeliverJob, threaddexDeliverJobProgress, threaddexGetJob } from '../src/tools/threaddex.js';

describe('Threaddex job API proxy tools', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.THREADEX_JOB_API_BASE_URL;
    delete process.env.THREADEX_JOB_API_BEARER_TOKEN;
    delete process.env.THREADEX_VISUAL_FOLLOWUP_BASE_URL;
    delete process.env.THREADEX_VISUAL_FOLLOWUP_BEARER_TOKEN;
  });

  it('reads jobs from the configured local Threaddex Job API', async () => {
    process.env.THREADEX_JOB_API_BASE_URL = 'http://127.0.0.1:33988';
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      expect(String(url)).toBe('http://127.0.0.1:33988/v1/job/job_123');
      expect(init.method).toBe('GET');
      return new Response(JSON.stringify({ ok: true, job_id: 'job_123' }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const result = await threaddexGetJob(fixtureWorkspace(), 'job_123') as any;
    expect(result.summary).toBe('threaddex job read');
    expect(result.data.response).toMatchObject({ ok: true, job_id: 'job_123' });
  });

  it('delivers final text through the configured Threaddex Job API with bearer auth', async () => {
    process.env.THREADEX_JOB_API_BASE_URL = 'http://127.0.0.1:33988';
    process.env.THREADEX_JOB_API_BEARER_TOKEN = 'test-token';
    const bodies: unknown[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      expect(String(url)).toBe('http://127.0.0.1:33988/v1/job/job_123/deliver');
      expect(init.method).toBe('POST');
      expect((init.headers as Record<string, string>).authorization).toBe('Bearer test-token');
      bodies.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ ok: true, state: 'telegram_delivered' }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const result = await threaddexDeliverJob(fixtureWorkspace(), 'job_123', 'done', 'job-api/1.0.1', '1.0.3') as any;
    expect(bodies[0]).toMatchObject({ text: 'done', protocol_version: 'job-api/1.0.1', schema_version: '1.0.3' });
    expect(result.data.response).toMatchObject({ ok: true, state: 'telegram_delivered' });
  });

  it('delivers progress with seq through the configured Threaddex Job API', async () => {
    process.env.THREADEX_VISUAL_FOLLOWUP_BASE_URL = 'http://127.0.0.1:33988';
    process.env.THREADEX_VISUAL_FOLLOWUP_BEARER_TOKEN = 'visual-token';
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      expect(String(url)).toBe('http://127.0.0.1:33988/v1/job/job_123/progress');
      expect((init.headers as Record<string, string>).authorization).toBe('Bearer visual-token');
      expect(JSON.parse(String(init.body))).toMatchObject({ text: 'working', seq: 7 });
      return new Response(JSON.stringify({ ok: true, progress: true }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const result = await threaddexDeliverJobProgress(fixtureWorkspace(), 'job_123', 'working', 7) as any;
    expect(result.summary).toBe('threaddex job progress delivered');
  });
});

function fixtureWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: 'boba', name: 'Boba', root: '/', realRoot: '/', allow_read: true, allow_write: true, allow_patch: true, allow_tests: true,
    allow_screen: true, allow_mouse_keyboard: true, browser: { profiles: [] }, commands: {}, api_sets: { workspace: true, browser: true, computer: true, machine_admin: true, estate_admin: false }, ...overrides
  };
}
