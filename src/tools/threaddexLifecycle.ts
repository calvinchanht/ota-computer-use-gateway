import { readFile } from 'node:fs/promises';
import { fail, ok, type ToolResult } from '../core/result.js';

const BASE_URL_ENV = 'THREADEX_JOB_API_BASE_URL';
const TOKEN_ENV = 'THREADEX_JOB_API_BEARER_TOKEN';
const TOKEN_FILE_ENV = 'THREADEX_JOB_API_BEARER_TOKEN_FILE';

const METHOD_ALIASES = new Map([
  ['get_job', 'get_job'],
  ['getJob', 'get_job'],
  ['read_task', 'get_job'],
  ['deliver_job_progress', 'deliver_job_progress'],
  ['deliverJobProgress', 'deliver_job_progress'],
  ['send_update', 'deliver_job_progress'],
  ['deliver_job', 'deliver_job'],
  ['deliverJob', 'deliver_job'],
  ['send_answer', 'deliver_job'],
  ['request_job_continuation', 'request_job_continuation'],
  ['requestJobContinuation', 'request_job_continuation']
]);

export function isThreaddexLifecycleMethod(method: string): boolean {
  return METHOD_ALIASES.has(method);
}

export async function callThreaddexLifecycle(method: string, args: Record<string, unknown>): Promise<ToolResult> {
  const normalized = METHOD_ALIASES.get(method);
  if (!normalized) return fail(`unsupported threaddex lifecycle method: ${method}`);
  try {
    const response = await fetch(`${baseUrl()}${pathFor(normalized, jobId(args))}`, await requestFor(normalized, args));
    const data = parseResponse(await response.text());
    if (!response.ok) return fail(`threaddex job lifecycle call failed: HTTP ${response.status}`, [JSON.stringify(data).slice(0, 1000)]);
    return ok('threaddex job lifecycle call completed', data);
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}

function pathFor(method: string, jobIdValue: string): string {
  const encoded = encodeURIComponent(jobIdValue);
  if (method === 'get_job') return `/v1/job/${encoded}`;
  if (method === 'deliver_job_progress') return `/v1/job/${encoded}/progress`;
  if (method === 'request_job_continuation') return `/v1/job/${encoded}/continuation`;
  return `/v1/job/${encoded}/deliver`;
}

async function requestFor(method: string, args: Record<string, unknown>): Promise<RequestInit> {
  const headers = await requestHeaders();
  if (method === 'get_job') return { method: 'GET', headers };
  return { method: 'POST', headers, body: JSON.stringify(requestBody(args)) };
}

function requestBody(args: Record<string, unknown>): Record<string, unknown> {
  const body = Object.fromEntries(Object.entries(args).filter(([key]) => key !== 'job_id'));
  if (body.text === undefined && body.message !== undefined) body.text = body.message;
  delete body.message;
  return body;
}

function jobId(args: Record<string, unknown>): string {
  if (typeof args.job_id === 'string' && args.job_id) return args.job_id;
  throw new Error('job_id is required');
}

async function requestHeaders(): Promise<Record<string, string>> {
  const token = await bearerToken();
  return { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) };
}

async function bearerToken(): Promise<string | undefined> {
  const envToken = process.env[TOKEN_ENV]?.trim();
  if (envToken) return envToken;
  const path = process.env[TOKEN_FILE_ENV]?.trim();
  if (!path) return undefined;
  const fileToken = (await readFile(path, 'utf8')).trim();
  return fileToken || undefined;
}

function baseUrl(): string {
  return (process.env[BASE_URL_ENV]?.trim() || 'http://127.0.0.1:33986').replace(/\/$/, '');
}

function parseResponse(text: string): unknown {
  try { return JSON.parse(text); }
  catch { return text; }
}
