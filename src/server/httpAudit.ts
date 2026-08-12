import { mkdir, appendFile } from 'node:fs/promises';
import { agentPath } from '../core/agentDir.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Workspace } from '../core/workspaces.js';
import { clientKey } from './rateLimit.js';

type HttpAuditEntry = {
  timestamp: string;
  method?: string;
  path?: string;
  status_code: number;
  duration_ms: number;
  client: string;
  content_length?: string;
  headers?: Record<string, string | undefined>;
};

type HttpAuditOptions = {
  onWriteError?: (error: unknown) => void;
};

export function auditHttpRequest(
  workspace: Workspace | null,
  req: IncomingMessage,
  res: ServerResponse,
  startedAt = Date.now(),
  options: HttpAuditOptions = {}
): void {
  if (!workspace || !req.url?.startsWith('/mcp')) return;
  res.once('finish', () => {
    void writeHttpAudit(workspace, entryFor(req, res, startedAt)).catch((error: unknown) => {
      options.onWriteError?.(error);
    });
  });
}

function entryFor(req: IncomingMessage, res: ServerResponse, startedAt: number): HttpAuditEntry {
  return {
    timestamp: new Date().toISOString(),
    method: req.method,
    path: requestPath(req),
    status_code: res.statusCode,
    duration_ms: Date.now() - startedAt,
    client: clientKey(req),
    content_length: headerValue(req.headers['content-length']),
    headers: safeRequestHeaders(req)
  };
}

async function writeHttpAudit(workspace: Workspace, entry: HttpAuditEntry): Promise<void> {
  const dir = agentPath(workspace, 'audit');
  await mkdir(dir, { recursive: true });
  await appendFile(agentPath(workspace, 'audit', 'http_requests.jsonl'), JSON.stringify(entry) + '\n');
}

function requestPath(req: IncomingMessage): string | undefined {
  return req.url?.split('?')[0];
}

function safeRequestHeaders(req: IncomingMessage): Record<string, string | undefined> | undefined {
  const names = [
    'origin',
    'referer',
    'referrer',
    'user-agent',
    'x-forwarded-for',
    'x-forwarded-host',
    'x-forwarded-proto',
    'cf-connecting-ip',
    'cf-ipcountry',
    'openai-conversation-id',
    'openai-ephemeral-user-id',
    'openai-gpt-id',
    'openai-subdivision-1-iso-code',
    'x-openai-conversation-id',
    'x-openai-project-id',
    'x-openai-gpt-id',
    'x-openai-action-invocation-id'
  ];
  const entries = names.map((name) => [name, headerValue(req.headers[name])] as const).filter(([, value]) => value !== undefined);
  return entries.length ? Object.fromEntries(entries) : undefined;
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
