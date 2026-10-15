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

const BROWSER_MANAGE_TAB_ACTIONS = new Set(['list_page_tabs_only', 'focus_by_url', 'focus_by_title', 'close_by_filter']);
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
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const URL_SCHEME_PATTERN = /^[A-Za-z][A-Za-z0-9+.-]{1,15}:/;
const SECRET_PREFIX_PATTERN = /^(?:(?:bearer|basic|secret|token|password)(?:[._-]|$)|(?:sk|gh[pousr]|github_pat|xox[baprs]|ya29)(?:[._-]|$)|AKIA[A-Z0-9]{12,}|AIza[A-Za-z0-9_-]{20,})/i;
const JWT_PATTERN = /^[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}$/;

export function toolAuditMetadata(tool: string, data: unknown, requestContext?: unknown, invocation?: unknown): AuditMetadata | undefined {
  const normalizedTool = tool.startsWith('api:') ? tool.slice(4) : tool;
  if (normalizedTool !== 'browser_manage_tabs') return undefined;

  const record = asRecord(data);
  const invoked = asRecord(invocation);
  const action = browserManageTabsAction(record?.action) ?? browserManageTabsAction(invoked?.action);
  const profileLabel = identifierString(record?.profile_label) ?? identifierString(invoked?.profile_label);
  const metadata: AuditMetadata = {
    ...(profileLabel ? { profile_label: profileLabel } : {}),
    ...(action ? { action } : {})
  };

  const targetIds = affectedTargetIds(action, record, invoked);
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

function affectedTargetIds(action: string | undefined, data: Record<string, unknown> | undefined, invocation: Record<string, unknown> | undefined): string[] {
  if (action === 'close_by_filter') {
    const successful = boundedTargetIds(Array.isArray(data?.closed) ? data.closed : []);
    return successful.length ? successful : boundedIdentifierList(invocation?.closed_target_ids);
  }
  if (action === 'focus_by_url' || action === 'focus_by_title') {
    return boundedTargetIds(data?.target ? [data.target] : []);
  }
  return [];
}

function boundedTargetIds(values: unknown[]): string[] {
  const ids: string[] = [];
  for (const value of values.slice(0, 50)) {
    const id = identifierString(asRecord(value)?.id);
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

function boundedIdentifierList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids: string[] = [];
  for (const candidate of value.slice(0, 50)) {
    const id = identifierString(candidate);
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
      const identifier = identifierString(source[key]);
      if (identifier) {
        context[key] = identifier;
        break;
      }
    }
  }
  return Object.keys(context).length ? context : undefined;
}

function browserManageTabsAction(value: unknown): string | undefined {
  return typeof value === 'string' && BROWSER_MANAGE_TAB_ACTIONS.has(value) ? value : undefined;
}

function identifierString(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value || value.length > 128) return undefined;
  if (URL_SCHEME_PATTERN.test(value) || !IDENTIFIER_PATTERN.test(value) || SECRET_PREFIX_PATTERN.test(value) || JWT_PATTERN.test(value)) return undefined;
  return value;
}

function boundedCount(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.min(Math.max(Math.trunc(value), 0), 100000);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
