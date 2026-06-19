import type { BrokeredExecutorJob, ExecutorResult } from './types.js';

type Json = Record<string, unknown>;

export type WorkerClientOptions = {
  brokerBaseUrl: string;
  executorId: string;
  executorKind: string;
  workerBearerToken?: string;
  fetchImpl?: typeof fetch;
};

export async function postExecutorHeartbeat(options: WorkerClientOptions, heartbeat: Json): Promise<Json> {
  return postJson(options, `/api/v1/executors/${encodeURIComponent(options.executorId)}/heartbeat`, heartbeat);
}

export async function claimExecutorJob(options: WorkerClientOptions, leaseMs?: number): Promise<BrokeredExecutorJob | undefined> {
  const body = await postJson(options, `/api/v1/executors/${encodeURIComponent(options.executorId)}/claim`, { executor_kind: options.executorKind, lease_ms: leaseMs });
  return body.no_job ? undefined : body.job as BrokeredExecutorJob;
}

export async function completeExecutorJob(options: WorkerClientOptions, job: BrokeredExecutorJob, result: ExecutorResult): Promise<Json> {
  const path = `/api/v1/executors/${encodeURIComponent(options.executorId)}/jobs/${encodeURIComponent(job.broker_job_id)}/complete`;
  return postJson(options, path, { executor_kind: options.executorKind, lease_owner: job.lease_owner, result });
}

async function postJson(options: WorkerClientOptions, path: string, body: Json): Promise<Json> {
  const response = await (options.fetchImpl ?? fetch)(`${trimSlash(options.brokerBaseUrl)}${path}`, {
    method: 'POST',
    headers: requestHeaders(options.workerBearerToken),
    body: JSON.stringify(body)
  });
  const parsed = await parseJson(response);
  if (!response.ok) throw new Error(`${response.status}: ${JSON.stringify(parsed)}`);
  return parsed as Json;
}

function requestHeaders(token?: string): Record<string, string> {
  return { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) };
}

async function parseJson(response: Response): Promise<unknown> {
  const text = await response.text();
  try { return text ? JSON.parse(text) : {}; } catch { return { ok: false, summary: text }; }
}

function trimSlash(value: string) {
  return value.replace(/\/$/, '');
}
