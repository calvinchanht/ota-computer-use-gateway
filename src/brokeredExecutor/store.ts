import { randomUUID } from 'node:crypto';
import type { BrokeredExecutorConfig, BrokeredExecutorDefinition, BrokeredExecutorJob, CompleteExecutorJobInput, ExecutorClaimInput, ExecutorHeartbeat, ExecutorHeartbeatInput, ExecutorResult, SubmitExecutorJobInput } from './types.js';
import { enabledExecutor, operationAllowed } from './config.js';

export class BrokeredExecutorStore {
  readonly jobs = new Map<string, BrokeredExecutorJob>();
  private readonly jobsByIdempotency = new Map<string, string>();
  readonly heartbeats = new Map<string, ExecutorHeartbeat>();

  submit(config: { brokered_executors?: BrokeredExecutorConfig }, input: SubmitExecutorJobInput): BrokeredExecutorJob {
    const executor = requireExecutor(config, input.executor_id, input.executor_kind);
    if (executor.agent_id !== input.target_agent_id) throw Object.assign(new Error(`executor ${input.executor_id} belongs to agent ${executor.agent_id}, not ${input.target_agent_id}`), { code: 'operation_not_allowed' });
    if (!operationAllowed(executor, input.operation_name)) throw Object.assign(new Error(`operation not allowed for executor ${input.executor_id}: ${input.operation_name}`), { code: 'operation_not_allowed' });
    const idem = input.idempotency_key;
    const existingId = idem ? this.jobsByIdempotency.get(idem) : undefined;
    const existing = existingId ? this.jobs.get(existingId) : undefined;
    if (existing) return existing;

    const now = new Date();
    const maxTtl = executor.max_ttl_ms ?? config.brokered_executors?.default_ttl_ms ?? 60_000;
    const ttlMs = Math.min(input.ttl_ms ?? maxTtl, maxTtl);
    const job: BrokeredExecutorJob = {
      broker_job_id: `bej_${randomUUID().replaceAll('-', '').slice(0, 16)}`,
      requester_agent_id: input.requester_agent_id,
      target_agent_id: input.target_agent_id,
      executor_id: input.executor_id,
      executor_kind: input.executor_kind,
      operation_name: input.operation_name,
      operation_arguments: input.operation_arguments,
      state: 'queued',
      idempotency_key: idem,
      ttl_expires_at: new Date(now.getTime() + ttlMs).toISOString(),
      artifacts: [],
      created_at: now.toISOString(),
      audit: [auditEvent('submitted', { requester_agent_id: input.requester_agent_id, target_agent_id: input.target_agent_id })]
    };
    this.jobs.set(job.broker_job_id, job);
    if (idem) this.jobsByIdempotency.set(idem, job.broker_job_id);
    return job;
  }

  heartbeat(input: ExecutorHeartbeatInput): ExecutorHeartbeat {
    const heartbeat = { ...input, last_seen_at: new Date().toISOString() };
    this.heartbeats.set(input.executor_id, heartbeat);
    return heartbeat;
  }

  claim(config: { brokered_executors?: BrokeredExecutorConfig }, input: ExecutorClaimInput): BrokeredExecutorJob | undefined {
    const executor = requireExecutor(config, input.executor_id, input.executor_kind);
    const now = new Date();
    this.expire(now);
    const job = [...this.jobs.values()].find((candidate) => candidate.executor_id === input.executor_id && candidate.executor_kind === input.executor_kind && candidate.state === 'queued');
    if (!job) return undefined;
    const leaseMs = Math.min(input.lease_ms ?? executor.default_lease_ms ?? config.brokered_executors?.default_lease_ms ?? 30_000, executor.default_lease_ms ?? config.brokered_executors?.default_lease_ms ?? 30_000);
    job.state = 'claimed';
    job.lease_owner = `${input.executor_id}:${randomUUID()}`;
    job.claimed_at = now.toISOString();
    job.started_at = job.claimed_at;
    job.lease_expires_at = new Date(now.getTime() + leaseMs).toISOString();
    job.audit.push(auditEvent('claimed', { executor_id: input.executor_id, lease_owner: job.lease_owner, lease_expires_at: job.lease_expires_at }));
    return job;
  }

  complete(jobId: string, input: CompleteExecutorJobInput): BrokeredExecutorJob {
    const job = requiredJob(this.jobs, jobId);
    assertValidLease(job, input.executor_id, input.lease_owner);
    applyResult(job, input.result);
    job.audit.push(auditEvent(input.result.status === 'succeeded' ? 'completed' : 'failed', { executor_id: input.executor_id, status: input.result.status, error_code: input.result.error_code }));
    return job;
  }

  fail(jobId: string, input: Omit<CompleteExecutorJobInput, 'result'> & { error_code: ExecutorResult['error_code']; error_message: string }): BrokeredExecutorJob {
    return this.complete(jobId, { executor_id: input.executor_id, lease_owner: input.lease_owner, result: { status: 'failed', result: {}, artifacts: [], error_code: input.error_code, error_message: input.error_message, audit: {} } });
  }

  get(jobId: string): BrokeredExecutorJob | undefined {
    this.expire(new Date());
    return this.jobs.get(jobId);
  }

  expire(now = new Date()): void {
    for (const job of this.jobs.values()) {
      if ((job.state === 'queued' || job.state === 'claimed') && Date.parse(job.ttl_expires_at) <= now.getTime()) {
        job.state = 'expired';
        job.finished_at = now.toISOString();
        job.error_code = 'timeout';
        job.error_message = 'brokered executor job ttl expired';
        job.audit.push(auditEvent('expired', { reason: 'ttl_expired' }));
      } else if (job.state === 'claimed' && job.lease_expires_at && Date.parse(job.lease_expires_at) <= now.getTime()) {
        job.state = 'queued';
        job.audit.push(auditEvent('lease_expired', { lease_owner: job.lease_owner }));
        delete job.lease_owner;
        delete job.lease_expires_at;
      }
    }
  }
}

export const brokeredExecutorStore = new BrokeredExecutorStore();

function requireExecutor(config: { brokered_executors?: BrokeredExecutorConfig }, executorId: string, executorKind: string): BrokeredExecutorDefinition {
  const executor = enabledExecutor(config, executorId);
  if (!executor) throw Object.assign(new Error('brokered executor is disabled or unknown'), { code: 'executor_offline' });
  if (executor.executor_kind !== executorKind) throw Object.assign(new Error(`executor kind mismatch for ${executorId}: expected ${executor.executor_kind}, received ${executorKind}`), { code: 'operation_not_allowed' });
  return executor;
}

function requiredJob(jobs: Map<string, BrokeredExecutorJob>, jobId: string): BrokeredExecutorJob {
  const job = jobs.get(jobId);
  if (!job) throw Object.assign(new Error('brokered executor job not found'), { code: 'operation_failed' });
  return job;
}

function assertValidLease(job: BrokeredExecutorJob, executorId: string, leaseOwner: string): void {
  if (job.executor_id !== executorId) throw Object.assign(new Error('executor does not own this job'), { code: 'operation_not_allowed' });
  if (job.state !== 'claimed' || job.lease_owner !== leaseOwner) throw Object.assign(new Error('valid lease is required to complete brokered executor job'), { code: 'lease_expired' });
  if (job.lease_expires_at && Date.parse(job.lease_expires_at) <= Date.now()) throw Object.assign(new Error('lease expired'), { code: 'lease_expired' });
}

function applyResult(job: BrokeredExecutorJob, result: ExecutorResult): void {
  job.result = result;
  job.artifacts = result.artifacts;
  job.state = result.status;
  job.error_code = result.error_code;
  job.error_message = result.error_message;
  job.finished_at = new Date().toISOString();
}

function auditEvent(event: string, data: Record<string, unknown> = {}): Record<string, unknown> {
  return { event, timestamp: new Date().toISOString(), ...data };
}
