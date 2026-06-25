import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { asText, fail, ok } from '../../core/result.js';
import { READ_ONLY, RUN_LOCAL, TOOL_RESULT_OUTPUT_SCHEMA } from './annotations.js';
import type { RegisterContext } from './types.js';

const BASE_URL_ENV = 'THREADEX_JOB_API_BASE_URL';
const TOKEN_ENV = 'THREADEX_JOB_API_BEARER_TOKEN';
const TOKEN_FILE_ENV = 'THREADEX_JOB_API_BEARER_TOKEN_FILE';

export function registerJobLifecycleTools({ server }: RegisterContext): void {
  for (const name of ['get_job', 'getJob']) {
    server.registerTool(name, {
      title: 'Get Threaddex job',
      description: 'Read a Threaddex job by id before doing work.',
      inputSchema: { job_id: z.string().min(1) },
      outputSchema: TOOL_RESULT_OUTPUT_SCHEMA,
      annotations: READ_ONLY
    }, async ({ job_id }) => proxy('GET', `/v1/job/${encodeURIComponent(job_id)}`));
  }
  for (const name of ['deliver_job_progress', 'deliverJobProgress']) {
    server.registerTool(name, {
      title: 'Deliver Threaddex job progress',
      description: 'Send useful non-final progress for the active job.',
      inputSchema: { job_id: z.string().min(1), text: z.string().min(1), progress_seq: z.union([z.string(), z.number()]).optional() },
      outputSchema: TOOL_RESULT_OUTPUT_SCHEMA,
      annotations: RUN_LOCAL
    }, async (args) => proxy('POST', `/v1/job/${encodeURIComponent(args.job_id)}/progress`, body(args)));
  }
  registerFinalTools(server);
  registerContinuationTools(server);
}

function registerFinalTools(server: RegisterContext['server']): void {
  for (const name of ['deliver_job', 'deliverJob']) {
    server.registerTool(name, {
      title: 'Deliver Threaddex job final',
      description: 'Send the final answer for the active job.',
      inputSchema: { job_id: z.string().min(1), text: z.string().min(1) },
      outputSchema: TOOL_RESULT_OUTPUT_SCHEMA,
      annotations: RUN_LOCAL
    }, async (args) => proxy('POST', `/v1/job/${encodeURIComponent(args.job_id)}/deliver`, body(args)));
  }
}

function registerContinuationTools(server: RegisterContext['server']): void {
  for (const name of ['request_job_continuation', 'requestJobContinuation']) {
    server.registerTool(name, {
      title: 'Request Threaddex job continuation',
      description: 'Record a continuation checkpoint and ask Threaddex to continue the same job.',
      inputSchema: { job_id: z.string().min(1), checkpoint: z.string().min(1), reason: z.string().optional(), next_prompt: z.string().optional(), max_continuations: z.number().int().min(1).max(999).optional() },
      outputSchema: TOOL_RESULT_OUTPUT_SCHEMA,
      annotations: RUN_LOCAL
    }, async (args) => proxy('POST', `/v1/job/${encodeURIComponent(args.job_id)}/continuation`, body(args)));
  }
}

async function proxy(method: 'GET' | 'POST', path: string, requestBody?: Record<string, unknown>) {
  try {
    const response = await fetch(`${baseUrl()}${path}`, { method, headers: await headers(), body: requestBody ? JSON.stringify(requestBody) : undefined });
    const text = await response.text();
    const data = parseResponse(text);
    return asText(response.ok ? ok('threaddex job lifecycle call completed', data) : fail(`threaddex job lifecycle call failed: HTTP ${response.status}`, [JSON.stringify(data).slice(0, 1000)]));
  } catch (error) {
    return asText(fail(error instanceof Error ? error.message : String(error)));
  }
}

async function headers(): Promise<Record<string, string>> {
  const token = await bearerToken();
  return { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) };
}

async function bearerToken(): Promise<string | undefined> {
  if (process.env[TOKEN_ENV]?.trim()) return process.env[TOKEN_ENV]!.trim();
  if (!process.env[TOKEN_FILE_ENV]?.trim()) return undefined;
  return (await readFile(process.env[TOKEN_FILE_ENV]!, 'utf8')).trim();
}

function baseUrl(): string {
  return (process.env[BASE_URL_ENV]?.trim() || 'http://127.0.0.1:33986').replace(/\/$/, '');
}

function body(args: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(args).filter(([key]) => key !== 'job_id'));
}

function parseResponse(text: string): unknown {
  try { return JSON.parse(text); }
  catch { return text; }
}
