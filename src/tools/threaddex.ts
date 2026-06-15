import { ok } from '../core/result.js';
import type { Workspace } from '../core/workspaces.js';

const DEFAULT_THREADEX_JOB_API_BASE_URL = 'http://127.0.0.1:33988';

export async function threaddexGetJob(workspace: Workspace, job_id: string) {
  const body = await threaddexRequest('GET', `/v1/job/${encodeURIComponent(job_id)}`);
  return ok('threaddex job read', { workspace_id: workspace.id, job_id, response: body });
}

export async function threaddexDeliverJob(workspace: Workspace, job_id: string, text: string, protocol_version?: string, schema_version?: string) {
  const body = await threaddexRequest('POST', `/v1/job/${encodeURIComponent(job_id)}/deliver`, compact({ text, protocol_version, schema_version }));
  return ok('threaddex job delivered', { workspace_id: workspace.id, job_id, response: body });
}

export async function threaddexDeliverJobProgress(workspace: Workspace, job_id: string, text: string, seq?: string | number, protocol_version?: string, schema_version?: string) {
  const body = await threaddexRequest('POST', `/v1/job/${encodeURIComponent(job_id)}/progress`, compact({ text, seq, protocol_version, schema_version }));
  return ok('threaddex job progress delivered', { workspace_id: workspace.id, job_id, response: body });
}

async function threaddexRequest(method: string, path: string, body?: Record<string, unknown>) {
  const base = stripTrailingSlash(process.env.THREADEX_JOB_API_BASE_URL ?? process.env.THREADEX_VISUAL_FOLLOWUP_BASE_URL ?? DEFAULT_THREADEX_JOB_API_BASE_URL);
  const response = await fetch(`${base}${path}`, {
    method,
    headers: headers(Boolean(body)),
    body: body ? JSON.stringify(body) : undefined
  });
  const payload = await response.json().catch(async () => ({ text: await response.text().catch(() => '') })) as Record<string, unknown>;
  if (!response.ok || payload.ok === false || payload.error) throw new Error(`threaddex request failed: ${response.status}:${String(payload.error ?? payload.summary ?? 'bad_response')}`);
  return payload;
}

function headers(hasBody: boolean): Record<string, string> {
  const out: Record<string, string> = {};
  if (hasBody) out['content-type'] = 'application/json';
  const bearer = process.env.THREADEX_JOB_API_BEARER_TOKEN ?? process.env.THREADEX_VISUAL_FOLLOWUP_BEARER_TOKEN;
  if (bearer) out.authorization = `Bearer ${bearer}`;
  return out;
}

function compact(values: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined));
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/$/, '');
}
