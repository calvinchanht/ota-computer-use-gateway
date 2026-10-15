import { mkdir, appendFile } from 'node:fs/promises';
import { agentPath } from './agentDir.js';
import type { Workspace } from './workspaces.js';

export type AuditMetadata = {
  profile_label?: string;
  action?: string;
  target_ids?: string[];
  matched?: number;
  request_context?: Record<string, string>;
};

export type AuditEntry = {
  timestamp: string;
  tool: string;
  workspace_id?: string;
  ok: boolean;
  summary: string;
  duration_ms: number;
  metadata?: AuditMetadata;
};

const REQUEST_CONTEXT_KEYS = [
  'provider',
  'project_id',
  'thread_id',
  'client_session_id',
  'agent_id',
  'conversation_lane',
  'lane',
  'job_id',
  'threaddex_job_id',
  'correlation_id',
  'request_id',
  'source_lane',
  'target_lane'
] as const;

export function toolAuditMetadata(tool: string, data: unknown, requestContext?: unknown): AuditMetadata | undefined {
  const normalizedTool = tool.startsWith('api:') ? tool.slice(4) : tool;
  if (normalizedTool !== 'browser_manage_tabs') return undefined;

  const record = asRecord(data);
  const action = boundedString(record?.action);
  const profileLabel = boundedString(record?.profile_label);
  const metadata: AuditMetadata = {
    ...(profileLabel ? { profile_label: profileLabel } : {}),
    ...(action ? { action } : {})
  };

  const targetIds = affectedTargetIds(action, record);
  if (targetIds.length) metadata.target_ids = targetIds;

  const matched = boundedCount(record?.matched);
  if (matched !== undefined) metadata.matched = matched;

  const context = boundedRequestContext(requestContext);
  if (context && Object.keys(context).length) metadata.request_context = context;

  return Object.keys(metadata).length ? metadata : undefined;
}

export async function audit(workspace: Workspace | null, entry: AuditEntry): Promise<void> {
  if (!workspace) return;
  const dir = agentPath(workspace, 'audit');
  await mkdir(dir, { recursive: true });
  await appendFile(agentPath(workspace, 'audit', 'tool_calls.jsonl'), JSON.stringify(entry) + '\n');
}

function affectedTargetIds(action: string | undefined, data: Record<string, unknown> | undefined): string[] {
  if (!data) return [];
  if (action === 'close_by_filter') {
    return boundedTargetIds(Array.isArray(data.closed) ? data.closed : []);
  }
  if (action === 'focus_by_url' || action === 'focus_by_title') {
    return boundedTargetIds(data.target ? [data.target] : []);
  }
  return [];
}

function boundedTargetIds(values: unknown[]): string[] {
  const ids: string[] = [];
  for (const value of values.slice(0, 50)) {
    const id = boundedString(asRecord(value)?.id, 256);
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

function boundedRequestContext(value: unknown): Record<string, string> | undefined {
  const outer = asRecord(value);
  if (!outer) return undefined;
  const thread = asRecord(outer.thread);
  const sources = [thread, outer].filter((source): source is Record<string, unknown> => Boolean(source));
  const context: Record<string, string> = {};
  for (const key of REQUEST_CONTEXT_KEYS) {
    for (const source of sources) {
      const bounded = boundedString(source[key], 256);
      if (bounded) {
        context[key] = bounded;
        break;
      }
    }
  }
  return Object.keys(context).length ? context : undefined;
}

function boundedCount(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.min(Math.max(Math.trunc(value), 0), 100000);
}

function boundedString(value: unknown, max = 200): string | undefined {
  if (typeof value !== 'string' || !value) return undefined;
  return value.slice(0, max);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
