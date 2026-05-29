import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { auditHttpRequest } from '../src/server/httpAudit.js';
import type { Workspace } from '../src/core/workspaces.js';

describe('HTTP request audit', () => {
  it('records safe MCP request metadata without bodies or auth headers', async () => {
    const workspace = await fixtureWorkspace();
    const req = request('/mcp?token=redacted', 'Bearer secret');
    const res = response(200);
    auditHttpRequest(workspace, req, res, 1000);
    res.emit('finish');
    await delay(20);

    const raw = await readFile(path.join(workspace.realRoot, '.agent/audit/http_requests.jsonl'), 'utf8');
    const entry = JSON.parse(raw.trim());
    expect(entry).toMatchObject({ method: 'POST', path: '/mcp', status_code: 200, client: '127.0.0.1' });
    expect(raw).not.toContain('secret');
    expect(raw).not.toContain('redacted');
  });

  it('ignores non-MCP requests', async () => {
    const workspace = await fixtureWorkspace();
    const res = response(200);
    auditHttpRequest(workspace, request('/healthz'), res);
    res.emit('finish');
    await expect(readFile(path.join(workspace.realRoot, '.agent/audit/http_requests.jsonl'), 'utf8')).rejects.toThrow();
  });
});

async function fixtureWorkspace(): Promise<Workspace> {
  const root = await mkdtemp(path.join(tmpdir(), 'ota-http-audit-'));
  return { id: 'test', name: 'Test', root, realRoot: root, allow_read: true, allow_write: false, allow_patch: true, allow_tests: false, allow_screen: false, allow_mouse_keyboard: false, commands: {} };
}

function request(url: string, authorization?: string) {
  return { method: 'POST', url, headers: { authorization, 'x-forwarded-for': '203.0.113.8', 'content-length': '42' }, socket: { remoteAddress: '127.0.0.1' } } as never;
}

function response(statusCode: number) {
  return Object.assign(new EventEmitter(), { statusCode, once: EventEmitter.prototype.once }) as never;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
