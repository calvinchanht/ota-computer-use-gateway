import { createServer as createHttpServer, type Server } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../src/config/schema.js';
import { createHttpRequestHandler } from '../src/server/http.js';

describe('HTTP browser tool durable audit context', () => {
  it('omits embedded credentials in nested thread and outer session IDs while retaining safe IDs', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ota-audit-context-'));
    let cdpFetches = 0;
    const cdp = createHttpServer((_req, res) => {
      cdpFetches += 1;
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify([
        { id: 'PRIVATE-TARGET', type: 'page', title: 'Private title', url: 'https://internal.invalid/private?token=hidden' }
      ]));
    });
    await listen(cdp);
    const config = fixtureConfig(root, port(cdp));
    const gateway = createHttpServer(createHttpRequestHandler(config));
    try {
      await listen(gateway);
      const syntheticPat = 'gho_' + 'a'.repeat(24);
      const syntheticJwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
      const syntheticOauth = 'xoxb-' + '1'.repeat(20);
      const tainted = await browserList(gateway, {
        client_session_id: 'client.' + syntheticOauth,
        requestor_url: 'https://internal.invalid/private?token=hidden',
        thread: {
          provider: 'chatgpt',
          agent_id: 'genesis',
          project_id: 'project.' + syntheticPat,
          thread_id: 'ctx.' + syntheticJwt,
          correlation_id: 'corr-4',
          job_id: 'task-1',
          source_lane: 'lane' + syntheticPat,
          target_lane: 'target' + syntheticOauth,
          request_id: syntheticPat
        }
      });
      expect(tainted).toMatchObject({ ok: true, summary: 'listed 1 page tabs' });

      const safe = await browserList(gateway, {
        client_session_id: 'session-outer',
        thread: {
          provider: 'chatgpt',
          agent_id: 'genesis',
          project_id: 'project-42',
          thread_id: 'thread-21',
          job_id: 'job-7',
          correlation_id: 'corr-4'
        }
      });
      expect(safe).toMatchObject({ ok: true, summary: 'listed 1 page tabs' });

      const raw = await readFile(path.join(root, '.agent/audit/tool_calls.jsonl'), 'utf8');
      const entries = raw.trim().split('\n').map((line) => JSON.parse(line));
      expect(entries).toHaveLength(2);
      expect(entries[0]).toMatchObject({
        tool: 'api:browser_manage_tabs',
        ok: true,
        metadata: {
          profile_label: 'Work Profile #1',
          action: 'list_page_tabs_only',
          request_context: { provider: 'chatgpt', agent_id: 'genesis', job_id: 'task-1', correlation_id: 'corr-4' }
        }
      });
      expect(entries[0].metadata.request_context).toEqual({
        provider: 'chatgpt', agent_id: 'genesis', job_id: 'task-1', correlation_id: 'corr-4'
      });
      expect(entries[1].metadata).toEqual({
        profile_label: 'Work Profile #1',
        action: 'list_page_tabs_only',
        request_context: {
          provider: 'chatgpt', project_id: 'project-42', thread_id: 'thread-21',
          client_session_id: 'session-outer', agent_id: 'genesis', job_id: 'job-7', correlation_id: 'corr-4'
        }
      });
      expect(cdpFetches).toBe(2);
      for (const forbidden of [syntheticPat, syntheticJwt, syntheticOauth, 'PRIVATE-TARGET', 'Private title', 'internal.invalid', 'token=hidden']) {
        expect(raw).not.toContain(forbidden);
      }
    } finally {
      await close(gateway);
      await close(cdp);
      await rm(root, { recursive: true, force: true });
    }
  });
});

async function browserList(server: Server, context: Record<string, unknown>): Promise<Record<string, unknown>> {
  const response = await fetch(`http://127.0.0.1:${port(server)}/api/v1/tool`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      operation: 'browser_manage_tabs',
      arguments: { workspace_id: 'test', action: 'list_page_tabs_only' },
      ...context
    })
  });
  expect(response.status).toBe(200);
  return await response.json() as Record<string, unknown>;
}

function fixtureConfig(root: string, cdpPort: number): AppConfig {
  return {
    server: {
      host: '127.0.0.1', port: 8765,
      auth: { enabled: false, bearer_token_env: 'TEST_BEARER', allow_loopback_without_auth: true },
      rate_limit: { enabled: false, window_ms: 60000, max_requests: 120, trust_proxy_headers: false },
      tool_annotations: { mode: 'honest' }, exposed_tools: []
    },
    workspaces: [{
      id: 'test', name: 'Safe audit fixture', root,
      allow_read: true, allow_write: false, allow_patch: false, allow_tests: false,
      allow_screen: false, allow_mouse_keyboard: false, api_sets: { browser: true },
      browser: { profiles: [{ label: 'Work Profile #1', cdp_host: '127.0.0.1', cdp_port: cdpPort, headed: true, default: true, launch: false }] },
      commands: {}
    }],
    security: { max_file_bytes: 200000, max_response_bytes: 50000, max_request_bytes: 1000000, max_search_results: 50, max_exec_ms: 120000 }
  } as AppConfig;
}

function port(server: Server): number {
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('expected TCP address');
  return address.port;
}

async function listen(server: Server): Promise<void> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
