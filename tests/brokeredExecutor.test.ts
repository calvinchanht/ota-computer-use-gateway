import { describe, expect, it } from 'vitest';
import { BrokeredExecutorStore } from '../src/brokeredExecutor/store.js';
import { BROKERED_EXECUTOR_CONTRACT_VERSION, type BrokeredExecutorConfig } from '../src/brokeredExecutor/types.js';
import { runFakeWindowsOperation } from '../src/brokeredExecutor/fakeAdapter.js';

const enabledConfig: { brokered_executors: BrokeredExecutorConfig } = {
  brokered_executors: {
    enabled: true,
    include_action_schema: false,
    default_ttl_ms: 60_000,
    default_lease_ms: 30_000,
    executors: [{
      executor_id: 'mickey-fake-windows',
      executor_kind: 'windows_computer_use',
      agent_id: 'mickey',
      enabled: true,
      allowed_operations: ['windows.status', 'windows.list_monitors', 'windows.list_windows', 'windows.screenshot'],
      default_lease_ms: 30_000,
      max_ttl_ms: 60_000
    }]
  }
};

const disabledConfig = { brokered_executors: { ...enabledConfig.brokered_executors, enabled: false } };

describe('brokered executor store', () => {
  it('is default-off and rejects submissions when disabled', () => {
    const store = new BrokeredExecutorStore();
    expect(() => store.submit(disabledConfig, {
      target_agent_id: 'mickey', executor_id: 'mickey-fake-windows', executor_kind: 'windows_computer_use', operation_name: 'windows.status', operation_arguments: {}
    })).toThrow(/disabled or unknown/);
  });

  it('submits, claims, and completes one read-only fake executor job', async () => {
    const store = new BrokeredExecutorStore();
    const job = store.submit(enabledConfig, {
      requester_agent_id: 'genesis', target_agent_id: 'mickey', executor_id: 'mickey-fake-windows', executor_kind: 'windows_computer_use', operation_name: 'windows.screenshot', operation_arguments: { monitor_id: 'primary' }, idempotency_key: 'idem-1'
    });
    expect(job.state).toBe('queued');
    expect(store.submit(enabledConfig, {
      requester_agent_id: 'genesis', target_agent_id: 'mickey', executor_id: 'mickey-fake-windows', executor_kind: 'windows_computer_use', operation_name: 'windows.screenshot', operation_arguments: { monitor_id: 'primary' }, idempotency_key: 'idem-1'
    }).broker_job_id).toBe(job.broker_job_id);

    const heartbeat = store.heartbeat({ executor_id: 'mickey-fake-windows', executor_kind: 'windows_computer_use', contract_version: BROKERED_EXECUTOR_CONTRACT_VERSION, supported_operations: ['windows.screenshot'] });
    expect(heartbeat.contract_version).toBe('brokered-executor-v1');

    const claimed = store.claim(enabledConfig, { executor_id: 'mickey-fake-windows', executor_kind: 'windows_computer_use' });
    expect(claimed?.broker_job_id).toBe(job.broker_job_id);
    expect(claimed?.state).toBe('claimed');
    expect(store.claim(enabledConfig, { executor_id: 'mickey-fake-windows', executor_kind: 'windows_computer_use' })).toBeUndefined();

    const result = await runFakeWindowsOperation(claimed!.operation_name, claimed!.operation_arguments);
    const completed = store.complete(claimed!.broker_job_id, { executor_id: 'mickey-fake-windows', lease_owner: claimed!.lease_owner!, result });
    expect(completed.state).toBe('succeeded');
    expect(completed.artifacts[0]?.mime_type).toBe('image/png');
    expect(completed.result?.result).toMatchObject({ monitor_id: 'primary' });
  });

  it('enforces per-agent and per-operation isolation', () => {
    const store = new BrokeredExecutorStore();
    expect(() => store.submit(enabledConfig, {
      target_agent_id: 'boba', executor_id: 'mickey-fake-windows', executor_kind: 'windows_computer_use', operation_name: 'windows.status', operation_arguments: {}
    })).toThrow(/belongs to agent mickey/);
    expect(() => store.submit(enabledConfig, {
      target_agent_id: 'mickey', executor_id: 'mickey-fake-windows', executor_kind: 'windows_computer_use', operation_name: 'windows.click', operation_arguments: {}
    })).toThrow(/operation not allowed/);
  });
});
