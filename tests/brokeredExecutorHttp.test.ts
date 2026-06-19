import { createServer, type Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AppConfig } from '../src/config/schema.js';
import { createHttpRequestHandler } from '../src/server/http.js';
import { BROKERED_EXECUTOR_CONTRACT_VERSION } from '../src/brokeredExecutor/types.js';

let server: Server | undefined;
let tempRoot: string | undefined;

afterEach(async () => {
  delete process.env.TEST_OTA_TOKEN;
  delete process.env.MICKEY_FAKE_EXECUTOR_TOKEN;
  if (server) await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
  server = undefined;
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
  tempRoot = undefined;
});

describe('brokered executor HTTP routes', () => {
  it('returns disabled and does not activate routes by default', async () => {
    const baseUrl = await start(defaultConfig(false));
    const response = await fetch(`${baseUrl}/api/v1/executor-jobs`, { method: 'POST', body: '{}' });
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ ok: false, error: 'brokered_executors_disabled' });
  });

  it('submits, claims, completes, and reads a brokered fake-executor result when explicitly enabled', async () => {
    process.env.TEST_OTA_TOKEN = 'main-secret';
    const baseUrl = await start(defaultConfig(true, true));
    const mainHeaders = { authorization: 'Bearer main-secret' };
    const submit = await post(`${baseUrl}/api/v1/executor-jobs`, {
      requester_agent_id: 'genesis',
      target_agent_id: 'mickey',
      executor_id: 'mickey-fake-windows',
      executor_kind: 'windows_computer_use',
      operation_name: 'windows.screenshot',
      operation_arguments: { monitor_id: 'primary' },
      idempotency_key: 'http-idem-1'
    }, mainHeaders);
    expect(submit.status).toBe(200);
    expect(submit.body.job).toMatchObject({ state: 'queued', target_agent_id: 'mickey', operation_name: 'windows.screenshot' });
    const jobId = submit.body.job.broker_job_id;

    process.env.MICKEY_FAKE_EXECUTOR_TOKEN = 'executor-secret';
    const rejectedHeartbeat = await post(`${baseUrl}/api/v1/executors/mickey-fake-windows/heartbeat`, {
      executor_kind: 'windows_computer_use',
      contract_version: BROKERED_EXECUTOR_CONTRACT_VERSION,
      supported_operations: ['windows.screenshot']
    }, mainHeaders);
    expect(rejectedHeartbeat.status).toBe(401);
    expect(rejectedHeartbeat.body).toMatchObject({ error: 'executor_unauthorized' });

    const workerHeaders = { authorization: 'Bearer executor-secret' };
    const heartbeat = await post(`${baseUrl}/api/v1/executors/mickey-fake-windows/heartbeat`, {
      executor_kind: 'windows_computer_use',
      contract_version: BROKERED_EXECUTOR_CONTRACT_VERSION,
      supported_operations: ['windows.status', 'windows.list_monitors', 'windows.list_windows', 'windows.screenshot']
    }, workerHeaders);
    expect(heartbeat.status).toBe(200);
    expect(heartbeat.body.heartbeat).toMatchObject({ executor_id: 'mickey-fake-windows', contract_version: 'brokered-executor-v1' });

    const claim = await post(`${baseUrl}/api/v1/executors/mickey-fake-windows/claim`, { executor_kind: 'windows_computer_use' }, workerHeaders);
    expect(claim.status).toBe(200);
    expect(claim.body.job).toMatchObject({ broker_job_id: jobId, state: 'claimed' });

    const complete = await post(`${baseUrl}/api/v1/executors/mickey-fake-windows/jobs/${jobId}/complete`, {
      executor_kind: 'windows_computer_use',
      lease_owner: claim.body.job.lease_owner,
      result: {
        status: 'succeeded',
        result: { monitor_id: 'primary' },
        artifacts: [{ kind: 'image', mime_type: 'image/png', artifact_path: '.agent/artifacts/fake-windows-screenshot.png', sha256: 'abc', bytes: 68 }],
        audit: { policy_decision: 'allowed' }
      }
    }, workerHeaders);
    expect(complete.status).toBe(200);
    expect(complete.body.job).toMatchObject({ state: 'succeeded', broker_job_id: jobId });

    const result = await fetch(`${baseUrl}/api/v1/executor-jobs/${jobId}/result`, { headers: mainHeaders });
    expect(result.status).toBe(200);
    await expect(result.json()).resolves.toMatchObject({ ok: true, state: 'succeeded', artifacts: [{ mime_type: 'image/png' }] });
  });
});

async function start(config: AppConfig): Promise<string> {
  server = createServer(createHttpRequestHandler(config));
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('expected TCP server address');
  return `http://127.0.0.1:${address.port}`;
}

async function post(url: string, body: unknown, extraHeaders: Record<string, string> = {}): Promise<{ status: number; body: any }> {
  const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...extraHeaders }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}

function defaultConfig(enabled: boolean, authEnabled = false): AppConfig {
  tempRoot = path.join(tmpdir(), `ota-brokered-executor-${Math.random().toString(36).slice(2)}`);
  return {
    server: {
      host: '127.0.0.1',
      port: 0,
      auth: { enabled: authEnabled, bearer_token_env: 'TEST_OTA_TOKEN', allow_loopback_without_auth: false },
      rate_limit: { enabled: false, window_ms: 60000, max_requests: 120, trust_proxy_headers: false },
      tool_annotations: { mode: 'honest' },
      exposed_tools: []
    },
    workspaces: [{
      id: 'mickey', name: 'Mickey', root: tempRoot,
      allow_read: true, allow_write: true, allow_patch: true, allow_tests: true, allow_screen: false, allow_mouse_keyboard: false,
      api_sets: { workspace: true }, browser: { profiles: [] }, windows_computer: { enabled: false, allow_screenshot: false, allow_uia_tree: false, allow_mouse: false, allow_keyboard: false, allow_clipboard: false, allow_window_management: false, allow_app_launch: false, allow_process_attach: false, allow_multi_monitor: true }, commands: {}, filesystem: { machine_admin_host_scope: false, host_root: '/' }, git: {}
    }],
    brokered_executors: {
      enabled,
      include_action_schema: false,
      default_ttl_ms: 60000,
      default_lease_ms: 30000,
      executors: enabled ? [{ executor_id: 'mickey-fake-windows', executor_kind: 'windows_computer_use', agent_id: 'mickey', enabled: true, allowed_operations: ['windows.status', 'windows.list_monitors', 'windows.list_windows', 'windows.screenshot'], default_lease_ms: 30000, max_ttl_ms: 60000, worker_bearer_token_env: 'MICKEY_FAKE_EXECUTOR_TOKEN' }] : []
    },
    security: { max_file_bytes: 100000, max_response_bytes: 100000, max_request_bytes: 100000, max_search_results: 10, max_exec_ms: 120000 }
  };
}
