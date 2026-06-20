import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppConfig } from '../config/schema.js';
import { brokeredExecutorEnabled, enabledExecutor } from '../brokeredExecutor/config.js';
import { brokeredExecutorStore } from '../brokeredExecutor/store.js';
import { completeExecutorJobSchema, executorClaimSchema, executorHeartbeatSchema, submitExecutorJobSchema } from '../brokeredExecutor/types.js';

const API_EXECUTOR_JOBS_PREFIX = '/api/v1/executor-jobs';
const API_EXECUTORS_PREFIX = '/api/v1/executors';

export function isBrokeredExecutorWorkerRequestAuthorized(config: AppConfig, req: IncomingMessage): boolean {
  const path = req.url?.split('?')[0] ?? '';
  const parts = executorPathParts(path);
  if (!parts || !isWorkerRoute(parts)) return false;
  const expected = expectedWorkerToken(config, parts[0]);
  return Boolean(expected && bearerTokenMatches(req, expected));
}

export async function handleBrokeredExecutorApi(config: AppConfig, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!brokeredExecutorEnabled(config)) return sendJson(res, 404, { ok: false, error: 'brokered_executors_disabled', summary: 'brokered executor stack is disabled' });
  const path = req.url?.split('?')[0] ?? '';
  try {
    if (path === API_EXECUTOR_JOBS_PREFIX && req.method === 'POST') return await handleBrokeredJobSubmit(config, req, res);
    if (path.startsWith(`${API_EXECUTOR_JOBS_PREFIX}/`) && req.method === 'GET') return handleBrokeredJobStatus(path, res);
    if (path.startsWith(`${API_EXECUTORS_PREFIX}/`) && req.method === 'POST') return await handleBrokeredExecutorWorkerApi(config, req, res, path);
    return sendJson(res, 404, { ok: false, error: 'brokered_executor_route_not_found' });
  } catch (error) {
    const body = brokeredExecutorErrorBody(error);
    return sendJson(res, body.status, body.body);
  }
}

async function handleBrokeredJobSubmit(config: AppConfig, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const parsed = await readApiJsonBody(req);
  if (!parsed.ok) return sendJson(res, parsed.status, { ok: false, error: parsed.error });
  const input = submitExecutorJobSchema.parse(parsed.body);
  const job = brokeredExecutorStore.submit(config, input);
  return sendJson(res, 200, { ok: true, summary: 'brokered executor job submitted', job });
}

function handleBrokeredJobStatus(path: string, res: ServerResponse): void {
  const rest = path.slice(`${API_EXECUTOR_JOBS_PREFIX}/`.length);
  const resultOnly = rest.endsWith('/result');
  const jobId = decodeURIComponent(resultOnly ? rest.slice(0, -'/result'.length) : rest);
  const job = brokeredExecutorStore.get(jobId);
  if (!job) return sendJson(res, 404, { ok: false, error: 'brokered_executor_job_not_found', broker_job_id: jobId });
  if (resultOnly) return sendJson(res, 200, brokeredJobResult(job));
  return sendJson(res, 200, { ok: true, summary: 'brokered executor job status', job });
}

function brokeredJobResult(job: ReturnType<typeof brokeredExecutorStore.get> & Record<string, unknown>): Record<string, unknown> {
  return { ok: true, summary: 'brokered executor job result', broker_job_id: job.broker_job_id, state: job.state, result: job.result, artifacts: job.artifacts, error_code: job.error_code, error_message: job.error_message };
}

async function handleBrokeredExecutorWorkerApi(config: AppConfig, req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
  const parts = executorPathParts(path);
  const executorId = parts?.[0];
  if (!parts || !executorId) return sendJson(res, 400, { ok: false, error: 'executor_id_required' });
  const auth = brokeredExecutorWorkerAuth(config, executorId, req);
  if (!auth.ok) return sendJson(res, auth.status, auth.body);
  const parsed = await readApiJsonBody(req);
  if (!parsed.ok) return sendJson(res, parsed.status, { ok: false, error: parsed.error });
  return handleWorkerAction(config, res, parts, withExecutorId(parsed.body, executorId));
}

function handleWorkerAction(config: AppConfig, res: ServerResponse, parts: string[], body: Record<string, unknown>): void {
  if (parts.length === 2 && parts[1] === 'heartbeat') return handleWorkerHeartbeat(res, body);
  if (parts.length === 2 && parts[1] === 'claim') return handleWorkerClaim(config, res, body);
  if (parts.length === 4 && parts[1] === 'jobs' && (parts[3] === 'complete' || parts[3] === 'fail')) return handleWorkerComplete(res, parts[2], body);
  return sendJson(res, 404, { ok: false, error: 'brokered_executor_worker_route_not_found' });
}

function handleWorkerHeartbeat(res: ServerResponse, body: Record<string, unknown>): void {
  const input = executorHeartbeatSchema.parse(body);
  const heartbeat = brokeredExecutorStore.heartbeat(input);
  return sendJson(res, 200, { ok: true, summary: 'brokered executor heartbeat recorded', heartbeat });
}

function handleWorkerClaim(config: AppConfig, res: ServerResponse, body: Record<string, unknown>): void {
  const input = executorClaimSchema.parse(body);
  const job = brokeredExecutorStore.claim(config, input);
  return sendJson(res, 200, job ? { ok: true, summary: 'brokered executor job claimed', job } : { ok: true, summary: 'no brokered executor job available', no_job: true });
}

function handleWorkerComplete(res: ServerResponse, brokerJobId: string, body: Record<string, unknown>): void {
  const input = completeExecutorJobSchema.parse(body);
  const job = brokeredExecutorStore.complete(brokerJobId, input);
  return sendJson(res, 200, { ok: true, summary: `brokered executor job ${input.result.status}`, job });
}

function brokeredExecutorWorkerAuth(config: AppConfig, executorId: string, req: IncomingMessage): { ok: true } | { ok: false; status: number; body: Record<string, unknown> } {
  const executor = enabledExecutor(config, executorId);
  if (!executor) return { ok: false, status: 404, body: { ok: false, error: 'executor_offline', error_code: 'executor_offline', message: 'brokered executor is disabled or unknown' } };
  const envName = executor.worker_bearer_token_env;
  if (!envName) return { ok: true };
  const expected = process.env[envName];
  if (!expected) return { ok: false, status: 401, body: { ok: false, error: 'executor_auth_missing', error_code: 'executor_auth_missing', message: `missing ${envName}` } };
  if (!bearerTokenMatches(req, expected)) return { ok: false, status: 401, body: { ok: false, error: 'executor_unauthorized', error_code: 'executor_unauthorized', message: 'invalid executor bearer token' } };
  return { ok: true };
}

function expectedWorkerToken(config: AppConfig, executorId: string): string | undefined {
  const envName = enabledExecutor(config, executorId)?.worker_bearer_token_env;
  return envName ? process.env[envName] : undefined;
}

function executorPathParts(path: string): string[] | null {
  if (!path.startsWith(`${API_EXECUTORS_PREFIX}/`)) return null;
  return path.slice(`${API_EXECUTORS_PREFIX}/`.length).split('/').map((part) => decodeURIComponent(part));
}

function isWorkerRoute(parts: string[]): boolean {
  return (parts.length === 2 && (parts[1] === 'heartbeat' || parts[1] === 'claim')) || (parts.length === 4 && parts[1] === 'jobs' && (parts[3] === 'complete' || parts[3] === 'fail'));
}

function withExecutorId(body: unknown, executorId: string): Record<string, unknown> {
  const source = body && typeof body === 'object' ? body as Record<string, unknown> : {};
  return { ...source, executor_id: source.executor_id ?? executorId };
}

function bearerTokenMatches(req: IncomingMessage, expected: string): boolean {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return false;
  const actualBuffer = Buffer.from(header.slice('Bearer '.length));
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function brokeredExecutorErrorBody(error: unknown): { status: number; body: Record<string, unknown> } {
  const message = error instanceof Error ? error.message : String(error);
  const code = error && typeof error === 'object' && 'code' in error && typeof (error as { code?: unknown }).code === 'string' ? (error as { code: string }).code : 'invalid_arguments';
  const status = code === 'executor_offline' ? 404 : code === 'operation_not_allowed' ? 403 : code === 'lease_expired' ? 409 : 400;
  return { status, body: { ok: false, error: code, error_code: code, message } };
}

async function readApiJsonBody(req: IncomingMessage): Promise<{ ok: true; body: unknown } | { ok: false; status: number; error: string }> {
  try {
    return { ok: true, body: await readJsonBody(req) };
  } catch {
    return { ok: false, status: 400, error: 'invalid_json' };
  }
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : undefined;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(body));
}
