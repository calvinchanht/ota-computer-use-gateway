import { createServer as createHttpServer, type Server } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { browserProfileSchema, type AppConfig } from '../src/config/schema.js';
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

      const syntheticApiKey = 'api_key_' + 'k'.repeat(28);
      const syntheticHyphenApiKey = 'api-key-' + 'm'.repeat(28);
      const syntheticSk = 'sk-' + 's'.repeat(28);
      const apiKeyTainted = await browserList(gateway, {
        client_session_id: 'client.' + syntheticApiKey,
        thread: {
          provider: 'chatgpt',
          agent_id: 'genesis',
          project_id: 'project.' + syntheticHyphenApiKey,
          thread_id: 'thread_' + syntheticApiKey,
          request_id: 'context' + syntheticSk,
          correlation_id: 'prefix' + syntheticSk,
          job_id: 'task-1',
          source_lane: 'source-1',
          target_lane: 'target-2'
        }
      });
      expect(apiKeyTainted).toMatchObject({ ok: true, summary: 'listed 1 page tabs' });

      const syntheticSkTest = 'sk_test_' + 't'.repeat(30);
      const syntheticSkLive = 'sk_live_' + 'l'.repeat(30);
      const syntheticAdjacentApiKey = 'api_key_' + 'q'.repeat(30);
      const syntheticCamelApiKey = 'apiKey-' + 'z'.repeat(30);
      const adjacentTainted = await browserList(gateway, {
        client_session_id: 'client' + syntheticSkLive,
        thread: {
          provider: 'chatgpt',
          agent_id: 'genesis',
          project_id: 'prefix' + syntheticSkTest,
          thread_id: 'ctx' + syntheticAdjacentApiKey,
          request_id: 'work' + syntheticCamelApiKey,
          correlation_id: 'corr-4',
          job_id: 'task-1',
          source_lane: 'source-1',
          target_lane: 'target-2'
        }
      });
      expect(adjacentTainted).toMatchObject({ ok: true, summary: 'listed 1 page tabs' });

      const longFamilyMarkers = ['password_', 'bearer_', 'token_', 'secret_', 'basic_']
        .map((family, index) => family + 'pbtse'[index]!.repeat(30));
      const familyTainted = await browserList(gateway, {
        client_session_id: 'session-outer',
        thread: {
          provider: 'chatgpt',
          agent_id: 'genesis',
          project_id: 'prefix' + longFamilyMarkers[0],
          thread_id: 'ctx' + longFamilyMarkers[1],
          request_id: 'work' + longFamilyMarkers[2],
          job_id: 'job' + longFamilyMarkers[3],
          lane: 'lane' + longFamilyMarkers[4],
          correlation_id: 'corr-4',
          source_lane: 'source-1',
          target_lane: 'target-2'
        }
      });
      expect(familyTainted).toMatchObject({ ok: true, summary: 'listed 1 page tabs' });

      const configuredProfile = config.workspaces[0]!.browser.profiles[0]!;
      const wrappedCredentialLabels = [
        "WorkProfileprefixpassword='" + 'p'.repeat(30) + "'",
        'WorkProfileprefixpassword="' + 'p'.repeat(30) + '"',
        'WorkProfileprefixpassword=(' + 'p'.repeat(30) + ')',
        'WorkProfileprefixpassword=[' + 'p'.repeat(30) + ']',
        'WorkProfileprefixpassword={' + 'p'.repeat(30) + '}',
        'WorkProfileprefixpassword=+' + 'p'.repeat(30),
        'WorkProfileprefixpassword= ' + 'p'.repeat(30),
        'WorkProfileprefixpassword =' + 'p'.repeat(30),
        'WorkProfileprefixbearer="' + 'b'.repeat(30) + '"',
        'WorkProfileprefixtoken=[' + 't'.repeat(30) + ']'
      ];
      const sessionCookieLabels = [
        "WorkProfileprefixsession='" + 's'.repeat(30) + "'",
        'WorkProfileprefixsession=' + 's'.repeat(30),
        'WorkProfileprefixsession_' + 's'.repeat(30),
        'WorkProfileprefixcookie="' + 'c'.repeat(30) + '"',
        'WorkProfileprefixcookie=' + 'c'.repeat(30),
        'WorkProfileprefixcookie_' + 'c'.repeat(30)
      ];
      const secretProfileLabels = [
        'WorkProfileprefix' + 'sk_test_' + 't'.repeat(30),
        'WorkProfileprefix' + 'apiKey-' + 'q'.repeat(30),
        ...longFamilyMarkers.map((marker) => 'WorkProfileprefix' + marker),
        'WorkProfileprefixpassword=' + 'p'.repeat(30),
        'WorkProfileprefixbearer=' + 'b'.repeat(30),
        'WorkProfileprefixtoken=' + 't'.repeat(30),
        'WorkProfileprefixpassword(' + 'p'.repeat(30) + ')',
        'WorkProfileprefixsecret/' + 's'.repeat(30),
        ...wrappedCredentialLabels,
        ...sessionCookieLabels
      ];
      for (const label of secretProfileLabels) {
        expect(browserProfileSchema.safeParse({ label }).success).toBe(true);
        configuredProfile.label = label;
        const result = await browserList(gateway, { thread: { provider: 'chatgpt', job_id: 'task-1' } });
        expect(result).toMatchObject({ ok: true, summary: 'listed 1 page tabs' });
      }
      for (const label of sessionCookieLabels) {
        configuredProfile.label = label;
        const explicit = await browserList(gateway, { thread: { provider: 'chatgpt', job_id: 'task-1' } }, label);
        expect(explicit).toMatchObject({ ok: true, summary: 'listed 1 page tabs' });
      }
      configuredProfile.label = 'R&D=QA #1';
      const benignProfile = await browserList(gateway, { thread: { provider: 'chatgpt', job_id: 'task-1' } });
      expect(benignProfile).toMatchObject({ ok: true, summary: 'listed 1 page tabs' });

      const unknownSensitive = 'UnknownWorkProfileprefixpassword=' + 'p'.repeat(30);
      const fetchesBeforeDenials = cdpFetches;
      const deniedSensitive = await browserList(gateway, {
        thread: { provider: 'chatgpt', job_id: 'task-1' }
      }, unknownSensitive);
      expect(deniedSensitive).toMatchObject({ ok: false, summary: 'unknown browser profile' });
      const unknownWrapped = 'UnknownWorkProfileprefixpassword="' + 'p'.repeat(30) + '"';
      const deniedWrapped = await browserList(gateway, {
        thread: { provider: 'chatgpt', job_id: 'task-1' }
      }, unknownWrapped);
      expect(deniedWrapped).toMatchObject({ ok: false, summary: 'unknown browser profile' });
      const unknownBenign = 'Unknown Work Profile #2';
      const deniedBenign = await browserList(gateway, {
        thread: { provider: 'chatgpt', job_id: 'task-1' }
      }, unknownBenign);
      expect(deniedBenign).toMatchObject({ ok: false, summary: 'unknown browser profile' });
      expect(cdpFetches).toBe(fetchesBeforeDenials);

      const raw = await readFile(path.join(root, '.agent/audit/tool_calls.jsonl'), 'utf8');
      const entries = raw.trim().split('\n').map((line) => JSON.parse(line));
      const sensitiveEnd = 5 + secretProfileLabels.length + sessionCookieLabels.length;
      expect(entries).toHaveLength(sensitiveEnd + 4);
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
      expect(entries[2].metadata).toEqual({
        profile_label: 'Work Profile #1',
        action: 'list_page_tabs_only',
        request_context: {
          provider: 'chatgpt', agent_id: 'genesis', job_id: 'task-1',
          source_lane: 'source-1', target_lane: 'target-2'
        }
      });
      expect(entries[3].metadata).toEqual({
        profile_label: 'Work Profile #1',
        action: 'list_page_tabs_only',
        request_context: {
          provider: 'chatgpt', agent_id: 'genesis', correlation_id: 'corr-4',
          job_id: 'task-1', source_lane: 'source-1', target_lane: 'target-2'
        }
      });
      expect(entries[4].metadata).toEqual({
        profile_label: 'Work Profile #1',
        action: 'list_page_tabs_only',
        request_context: {
          provider: 'chatgpt', client_session_id: 'session-outer', agent_id: 'genesis',
          correlation_id: 'corr-4', source_lane: 'source-1', target_lane: 'target-2'
        }
      });
      for (const entry of entries.slice(5, sensitiveEnd)) {
        expect(entry.metadata).toEqual({
          action: 'list_page_tabs_only',
          request_context: { provider: 'chatgpt', job_id: 'task-1' }
        });
      }
      expect(entries[sensitiveEnd].metadata).toEqual({
        profile_label: 'R&D=QA #1',
        action: 'list_page_tabs_only',
        request_context: { provider: 'chatgpt', job_id: 'task-1' }
      });
      for (const entry of entries.slice(sensitiveEnd + 1)) {
        expect(entry).toMatchObject({
          ok: false,
          summary: 'unknown browser profile',
          metadata: {
            action: 'list_page_tabs_only',
            request_context: { provider: 'chatgpt', job_id: 'task-1' }
          }
        });
        expect(entry.metadata.profile_label).toBeUndefined();
      }
      expect(cdpFetches).toBe(sensitiveEnd + 1);
      for (const forbidden of [
        syntheticPat, syntheticJwt, syntheticOauth, syntheticApiKey, syntheticHyphenApiKey, syntheticSk,
        syntheticSkTest, syntheticSkLive, syntheticAdjacentApiKey, syntheticCamelApiKey,
        ...longFamilyMarkers, ...secretProfileLabels, unknownSensitive, unknownWrapped, unknownBenign,
        'PRIVATE-TARGET', 'Private title', 'internal.invalid', 'token=hidden'
      ]) {
        expect(raw).not.toContain(forbidden);
      }
    } finally {
      await close(gateway);
      await close(cdp);
      await rm(root, { recursive: true, force: true });
    }
  });
});

async function browserList(server: Server, context: Record<string, unknown>, profileLabel?: string): Promise<Record<string, unknown>> {
  const response = await fetch(`http://127.0.0.1:${port(server)}/api/v1/tool`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      operation: 'browser_manage_tabs',
      arguments: { workspace_id: 'test', action: 'list_page_tabs_only', ...(profileLabel ? { profile_label: profileLabel } : {}) },
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
