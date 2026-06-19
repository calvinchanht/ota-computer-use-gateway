import { describe, expect, it, vi } from 'vitest';
import type { BrokeredExecutorJob } from '../src/brokeredExecutor/types.js';
import { mapWindowsOperation, runWindowsBrokeredOperation, windowsExecutorHeartbeat } from '../src/brokeredExecutor/windowsAdapter.js';
import { claimExecutorJob, completeExecutorJob, postExecutorHeartbeat } from '../src/brokeredExecutor/workerClient.js';

describe('Windows brokered executor adapter', () => {
  it('maps public broker operation names to local OTA Windows tool names', () => {
    expect(mapWindowsOperation('windows.status', {})).toEqual({ tool: 'windows_computer_status', arguments: {} });
    expect(mapWindowsOperation('windows.list_monitors', {})).toEqual({ tool: 'windows_list_monitors', arguments: {} });
    expect(mapWindowsOperation('windows.list_windows', {})).toEqual({ tool: 'windows_list_windows', arguments: {} });
    expect(mapWindowsOperation('windows.screenshot', { monitor_id: 'primary' })).toEqual({ tool: 'windows_screenshot', arguments: { monitor: 'primary' } });
    expect(mapWindowsOperation('windows.click', {})).toBeUndefined();
  });

  it('returns a contract-version heartbeat for Anna Windows workers', () => {
    expect(windowsExecutorHeartbeat('anna-windows-local')).toMatchObject({
      executor_id: 'anna-windows-local',
      executor_kind: 'windows_computer_use',
      contract_version: 'brokered-executor-v1',
      supported_operations: ['windows.status', 'windows.list_monitors', 'windows.list_windows', 'windows.screenshot']
    });
  });

  it('calls localhost OTA and normalizes screenshot artifacts', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(toolSuccess()));
    const result = await runWindowsBrokeredOperation(adapter(fetchImpl), job('windows.screenshot', { monitor_id: 'primary' }));
    expect(fetchImpl).toHaveBeenCalledWith('http://127.0.0.1:8769/api/v1/tool', expect.objectContaining({ method: 'POST' }));
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toMatchObject({ tool: 'windows_screenshot', arguments: { workspace_id: 'anna', monitor: 'primary' } });
    expect(result).toMatchObject({ status: 'succeeded', artifacts: [{ mime_type: 'image/webp' }, { mime_type: 'image/png' }] });
  });

  it('classifies local OTA policy failures', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ ok: false, summary: 'windows computer-use capability disabled: allow_screenshot' }));
    const result = await runWindowsBrokeredOperation(adapter(fetchImpl), job('windows.screenshot', {}));
    expect(result).toMatchObject({ status: 'failed', error_code: 'local_ota_policy_denied' });
  });
});

describe('brokered executor worker client', () => {
  it('uses worker bearer auth for heartbeat claim and complete', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ ok: true, heartbeat: {} }))
      .mockResolvedValueOnce(jsonResponse({ ok: true, job: job('windows.status') }))
      .mockResolvedValueOnce(jsonResponse({ ok: true, job: { state: 'succeeded' } }));
    const options = worker(fetchImpl);
    await postExecutorHeartbeat(options, windowsExecutorHeartbeat('anna-windows-local'));
    const claimed = await claimExecutorJob(options);
    await completeExecutorJob(options, claimed!, { status: 'succeeded', result: {}, artifacts: [], audit: {} });
    expect(fetchImpl.mock.calls.map((call) => call[0])).toEqual([
      'https://anna-api.unrealize.com/ota/api/v1/executors/anna-windows-local/heartbeat',
      'https://anna-api.unrealize.com/ota/api/v1/executors/anna-windows-local/claim',
      'https://anna-api.unrealize.com/ota/api/v1/executors/anna-windows-local/jobs/bej_test/complete'
    ]);
    expect(fetchImpl.mock.calls[0][1].headers.authorization).toBe('Bearer worker-secret');
  });
});

function adapter(fetchImpl: typeof fetch) {
  return { localOtaBaseUrl: 'http://127.0.0.1:8769', workspaceId: 'anna', fetchImpl };
}

function worker(fetchImpl: typeof fetch) {
  return { brokerBaseUrl: 'https://anna-api.unrealize.com/ota', executorId: 'anna-windows-local', executorKind: 'windows_computer_use', workerBearerToken: 'worker-secret', fetchImpl };
}

function job(operationName: string, args: Record<string, unknown> = {}): BrokeredExecutorJob {
  return { broker_job_id: 'bej_test', target_agent_id: 'anna', executor_id: 'anna-windows-local', executor_kind: 'windows_computer_use', operation_name: operationName, operation_arguments: args, state: 'claimed', lease_owner: 'lease', ttl_expires_at: new Date(Date.now() + 60000).toISOString(), artifacts: [], created_at: new Date().toISOString(), audit: [] };
}

function toolSuccess() {
  return { ok: true, summary: 'windows screenshot', data: { monitor: 'primary', artifact: { preview: { format: 'webp', path: '.agent/artifacts/p.webp', readable_url: 'https://anna-api.unrealize.com/ota/api/v1/artifacts/anna/.agent%2Fartifacts%2Fp.webp?expires=1800000000' }, full: { format: 'png', path: '.agent/artifacts/f.png' } } } };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}
