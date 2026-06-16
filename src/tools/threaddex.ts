import { readFile } from 'node:fs/promises';
import { ok } from '../core/result.js';
import type { Workspace } from '../core/workspaces.js';

const DEFAULT_THREADEX_JOB_API_BASE_URL = 'http://127.0.0.1:33988';

export async function threaddexGetJob(workspace: Workspace, job_id: string) {
  const body = await threaddexRequest(workspace, 'GET', `/v1/job/${encodeURIComponent(job_id)}`);
  return ok('threaddex job read', { workspace_id: workspace.id, job_id, response: body });
}

export async function threaddexDeliverJob(workspace: Workspace, job_id: string, text: string, protocol_version?: string, schema_version?: string) {
  const body = await threaddexRequest(workspace, 'POST', `/v1/job/${encodeURIComponent(job_id)}/deliver`, compact({ text, protocol_version, schema_version }));
  return ok('threaddex job delivered', { workspace_id: workspace.id, job_id, response: body });
}

export async function threaddexDeliverJobProgress(workspace: Workspace, job_id: string, text: string, seq?: string | number, protocol_version?: string, schema_version?: string) {
  const body = await threaddexRequest(workspace, 'POST', `/v1/job/${encodeURIComponent(job_id)}/progress`, compact({ text, seq, protocol_version, schema_version }));
  return ok('threaddex job progress delivered', { workspace_id: workspace.id, job_id, response: body });
}

async function threaddexRequest(workspace: Workspace, method: string, path: string, body?: Record<string, unknown>) {
  const base = stripTrailingSlash(process.env.THREADEX_JOB_API_BASE_URL ?? process.env.THREADEX_VISUAL_FOLLOWUP_BASE_URL ?? defaultBaseUrl(workspace));
  const response = await fetch(`${base}${path}`, {
    method,
    headers: await headers(Boolean(body)),
    body: body ? JSON.stringify(body) : undefined
  });
  const payload = await response.json().catch(async () => ({ text: await response.text().catch(() => '') }));
  if (!response.ok || (payload && typeof payload === 'object' && ('ok' in payload && payload.ok === false || 'error' in payload))) {
    const err = payload && typeof payload === 'object' ? String((payload as Record<string, unknown>).error ?? (payload as Record<string, unknown>).summary ?? 'bad_response') : 'bad_response';
    throw new Error(`threaddex request failed: ${response.status}:${err}`);
  }
  return payload;
}

async function headers(hasBody: boolean): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  if (hasBody) out['content-type'] = 'application/json';
  const bearer = await bearerToken();
  if (bearer) out.authorization = `Bearer ${bearer}`;
  return out;
}

async function bearerToken(): Promise<string | undefined> {
  const direct = process.env.THREADEX_JOB_API_BEARER_TOKEN ?? process.env.THREADEX_VISUAL_FOLLOWUP_BEARER_TOKEN;
  if (direct) return direct;
  const file = process.env.THREADEX_JOB_API_BEARER_TOKEN_FILE ?? process.env.THREADEX_VISUAL_FOLLOWUP_BEARER_TOKEN_FILE;
  if (!file) return undefined;
  return (await readFile(file, 'utf8')).trim();
}

function defaultBaseUrl(workspace: Workspace): string {
  if (workspace.id === 'genesis') return 'http://127.0.0.1:33986';
  if (workspace.id === 'mickey') return 'http://127.0.0.1:33987';
  return DEFAULT_THREADEX_JOB_API_BASE_URL;
}

function compact(values: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined));
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/$/, '');
}
