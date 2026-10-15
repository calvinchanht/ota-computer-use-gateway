import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { toolAuditMetadata } from '../src/core/audit.js';
import { runWorkspaceTool } from '../src/core/toolRunner.js';
import { ok } from '../src/core/result.js';
import type { Workspace } from '../src/core/workspaces.js';
import { browserManageTabs, browserManageTabsAuditInvocation } from '../src/tools/browser.js';

describe('runWorkspaceTool', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('writes audit entries', async () => {
    const workspace = await fixtureWorkspace();
    await runWorkspaceTool(new Map([[workspace.id, workspace]]), workspace.id, 'demo', async () => ok('done'));
    const audit = await readAudit(workspace);
    expect(audit.tool).toBe('demo');
    expect(audit.ok).toBe(true);
  });

  it('records bounded browser tab-close attribution without URL or title payloads', async () => {
    const workspace = await fixtureWorkspace();
    await runWorkspaceTool(new Map([[workspace.id, workspace]]), workspace.id, 'browser_manage_tabs', async () => ok('closed 2 browser tabs', {
      workspace_id: workspace.id,
      profile_label: 'rosebot-browser',
      action: 'close_by_filter',
      matched: 3,
      closed: [
        { id: 'TARGET-1', title: 'private title', url: 'https://chatgpt.com/c/one?secret=alpha' },
        { id: 'TARGET-2', title: 'other private title', url: 'https://chatgpt.com/c/two?secret=beta' }
      ]
    }));
    const raw = await readFile(path.join(workspace.realRoot, '.agent/audit/tool_calls.jsonl'), 'utf8');
    const audit = JSON.parse(raw.trim());
    expect(audit.metadata).toEqual({
      profile_label: 'rosebot-browser',
      action: 'close_by_filter',
      target_ids: ['TARGET-1', 'TARGET-2'],
      matched: 3
    });
    expect(raw).not.toContain('secret=alpha');
    expect(raw).not.toContain('private title');
  });

  it('audits the actual list-only browser tool with action/profile and no affected targets', async () => {
    const workspace = await browserWorkspace();
    mockFetch([{ id: 'TARGET-1', type: 'page', title: 'Private', url: 'https://example.com/path?token=secret' }]);
    await runWorkspaceTool(
      new Map([[workspace.id, workspace]]),
      workspace.id,
      'browser_manage_tabs',
      (current) => browserManageTabs(current, { action: 'list_page_tabs_only' }),
      (current) => browserManageTabsAuditInvocation(current, 'list_page_tabs_only')
    );
    const raw = await readFile(path.join(workspace.realRoot, '.agent/audit/tool_calls.jsonl'), 'utf8');
    const audit = JSON.parse(raw.trim());
    expect(audit.ok).toBe(true);
    expect(audit.metadata).toEqual({
      profile_label: 'work',
      action: 'list_page_tabs_only'
    });
    expect(raw).not.toContain('TARGET-1');
    expect(raw).not.toContain('token=secret');
  });

  it('audits the actual failed browser tool with invocation action/profile', async () => {
    const workspace = await browserWorkspace();
    mockFetch([]);
    const result = await runWorkspaceTool(
      new Map([[workspace.id, workspace]]),
      workspace.id,
      'browser_manage_tabs',
      (current) => browserManageTabs(current, { action: 'close_by_filter' }),
      (current) => browserManageTabsAuditInvocation(current, 'close_by_filter')
    );
    expect(result.content[0].text).toContain('browser CDP control is not enabled');
    const audit = await readAudit(workspace);
    expect(audit.ok).toBe(false);
    expect(audit.metadata).toEqual({
      profile_label: 'work',
      action: 'close_by_filter'
    });
  });

  it('allowlists identifier-like API caller and correlation context without persisting URLs', () => {
    const metadata = toolAuditMetadata('api:browser_manage_tabs', {
      profile_label: 'rosebot-browser',
      action: 'close_by_filter',
      closed: [{ id: 'TARGET-1' }]
    }, {
      requestor_url: 'https://chatgpt.com/g/example/c/secret?token=hidden',
      client_session_id: 'session-outer',
      thread: {
        provider: 'chatgpt',
        project_id: 'project-1',
        thread_id: 'thread-1',
        thread_url: 'https://chatgpt.com/c/private?token=hidden',
        agent_id: 'rosebot',
        conversation_lane: 'main',
        job_id: 'job-1',
        correlation_id: 'corr-1'
      }
    });
    expect(metadata).toEqual({
      profile_label: 'rosebot-browser',
      action: 'close_by_filter',
      target_ids: ['TARGET-1'],
      request_context: {
        provider: 'chatgpt',
        project_id: 'project-1',
        thread_id: 'thread-1',
        client_session_id: 'session-outer',
        agent_id: 'rosebot',
        conversation_lane: 'main',
        job_id: 'job-1',
        correlation_id: 'corr-1'
      }
    });
    expect(JSON.stringify(metadata)).not.toContain('requestor_url');
    expect(JSON.stringify(metadata)).not.toContain('thread_url');
    expect(JSON.stringify(metadata)).not.toContain('token=hidden');
  });

  it('rejects sensitive or free-text values even when they use allowlisted context keys', () => {
    const metadata = toolAuditMetadata('api:browser_manage_tabs', undefined, {
      client_session_id: 'session-ok',
      thread: {
        provider: 'chatgpt',
        project_id: 'project-ok',
        thread_id: 'https://chatgpt.com/c/x?token=secret',
        conversation_lane: 'main lane with free text',
        job_id: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzZWNyZXQifQ.signature12345',
        correlation_id: 'Bearer:secret-token',
        request_id: 'line-one\nline-two',
        source_lane: 'sk-secretvalue',
        target_lane: 'main'
      }
    }, {
      profile_label: 'work',
      action: 'close_by_filter'
    });
    expect(metadata).toEqual({
      profile_label: 'work',
      action: 'close_by_filter',
      request_context: {
        provider: 'chatgpt',
        project_id: 'project-ok',
        client_session_id: 'session-ok',
        target_lane: 'main'
      }
    });
    const serialized = JSON.stringify(metadata);
    for (const forbidden of ['https://', 'token=secret', 'Bearer', 'signature12345', 'line-one', 'sk-secretvalue', 'free text']) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('keeps failed tool calls auditable', async () => {
    const workspace = await fixtureWorkspace();
    await runWorkspaceTool(new Map([[workspace.id, workspace]]), workspace.id, 'browser_manage_tabs', async () => {
      throw new Error('close failed');
    }, { profile_label: 'work', action: 'close_by_filter' });
    const audit = await readAudit(workspace);
    expect(audit.tool).toBe('browser_manage_tabs');
    expect(audit.ok).toBe(false);
    expect(audit.summary).toBe('close failed');
    expect(audit.metadata).toEqual({ profile_label: 'work', action: 'close_by_filter' });
  });

  it('blocks tools when panic stop is active', async () => {
    const workspace = await fixtureWorkspace();
    await mkdir(path.join(workspace.realRoot, '.agent'), { recursive: true });
    await writeFile(path.join(workspace.realRoot, '.agent/PANIC_STOP'), 'stop');
    const result = await runWorkspaceTool(new Map([[workspace.id, workspace]]), workspace.id, 'read_file', async () => ok('done'));
    expect(result.content[0].text).toContain('panic stop');
  });
});

async function readAudit(workspace: Workspace): Promise<Record<string, any>> {
  const audit = await readFile(path.join(workspace.realRoot, '.agent/audit/tool_calls.jsonl'), 'utf8');
  return JSON.parse(audit.trim());
}

function mockFetch(body: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => body, text: async () => String(body) })));
}

async function browserWorkspace(): Promise<Workspace> {
  return fixtureWorkspace({
    browser: {
      profiles: [{ label: 'work', cdp_host: '127.0.0.1', cdp_port: 9444, headed: true, default: true, launch: false }]
    }
  });
}

async function fixtureWorkspace(overrides: Partial<Workspace> = {}): Promise<Workspace> {
  const root = await mkdtemp(path.join(tmpdir(), 'gtp-runner-'));
  return {
    id: 'test',
    name: 'Test',
    root,
    realRoot: root,
    allow_read: true,
    allow_write: false,
    allow_patch: false,
    allow_tests: false,
    allow_screen: false,
    allow_mouse_keyboard: false,
    browser: { profiles: [] },
    commands: {},
    ...overrides
  };
}
