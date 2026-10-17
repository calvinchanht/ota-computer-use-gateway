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

  it('audits the actual list-only browser tool with schema-valid profile punctuation and no affected targets', async () => {
    const workspace = await browserWorkspace({
      browser: {
        profiles: [{ label: 'Work Profile #1', cdp_host: '127.0.0.1', cdp_port: 9444, headed: true, default: true, launch: false }]
      }
    });
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
      profile_label: 'Work Profile #1',
      action: 'list_page_tabs_only'
    });
    expect(raw).not.toContain('TARGET-1');
    expect(raw).not.toContain('token=secret');
  });

  it('keeps ordinary profile labels with #, & and = without weakening audit redaction', () => {
    for (const profileLabel of ['Work Profile #1', 'Research & QA', 'QA = Ready', 'R&D=QA #1']) {
      expect(toolAuditMetadata('browser_manage_tabs', undefined, undefined, {
        profile_label: profileLabel,
        action: 'list_page_tabs_only'
      })).toEqual({ profile_label: profileLabel, action: 'list_page_tabs_only' });
    }
  });

  it('rejects sensitive or transcript-like profile labels from audit projection', () => {
    for (const profileLabel of [
      'https:example.com',
      'mailto:user@example.com',
      'Work Profile https:example.com',
      'Bearer secret-token',
      'gho_abcdefghijklmnopqrstuvwxyz',
      'Work Profile gho_abcdefghijklmnopqrstuvwxyz',
      'token=secret',
      'Work Profile #token=secret',
      'work&session=abc',
      'work&option=value',
      'profile?token=secret',
      'this is an arbitrary transcript sentence with too many words to retain'
    ]) {
      expect(toolAuditMetadata('browser_manage_tabs', undefined, undefined, {
        profile_label: profileLabel,
        action: 'list_page_tabs_only'
      })).toEqual({ action: 'list_page_tabs_only' });
    }
  });

  it('omits embedded URL and credential markers in actual list-only browser audit JSONL', async () => {
    const sensitiveLabels = [
      'Work Profile (https://internal.example/private)',
      'Work Profile <https://internal.example/private>',
      'Archive [ftp://internal.example/private]',
      'QA (sk-abcdef1234567890)',
      'QA <gho_abcdefghijklmnopqrstuvwxyz>',
      'Ops {token:secret}',
      'SRE / Bearer secret-token',
      'QA [AKIAABCDEFGHIJKLMNOP]',
      'Ops [eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c]',
      'QA <password(secret)>',
      'Support {api_key(secret)}',
      'QA / token(secret)',
      'Ops (ssh://alice:synthetic@internal.invalid/private)',
      'Ops (chrome://settings/private)',
      'QA <a://private.invalid/path>'
    ];
    for (const label of sensitiveLabels) {
      const workspace = await browserWorkspace({
        browser: {
          profiles: [{ label, cdp_host: '127.0.0.1', cdp_port: 9444, headed: true, default: true, launch: false }]
        }
      });
      mockFetch([{ id: 'PRIVATE-TARGET', type: 'page', title: 'Private', url: 'https://internal.example/?token=private' }]);
      await runWorkspaceTool(
        new Map([[workspace.id, workspace]]),
        workspace.id,
        'browser_manage_tabs',
        (current) => browserManageTabs(current, { action: 'list_page_tabs_only' }),
        (current) => browserManageTabsAuditInvocation(current, 'list_page_tabs_only')
      );
      const raw = await readFile(path.join(workspace.realRoot, '.agent/audit/tool_calls.jsonl'), 'utf8');
      const entry = JSON.parse(raw.trim());
      expect(entry.ok).toBe(true);
      expect(entry.metadata).toEqual({ action: 'list_page_tabs_only' });
      expect(raw).not.toContain(label);
      expect(raw).not.toContain('PRIVATE-TARGET');
      expect(raw).not.toContain('internal.example');
    }
  });

  it('keeps reserved-profile denial but never audits its URL-bearing label or calls CDP', async () => {
    const label = 'Ops (https://internal.example/private)';
    const workspace = await browserWorkspace({
      browser: {
        profiles: [{ label, purpose: 'threaddex', cdp_host: '127.0.0.1', cdp_port: 9444, headed: true, default: true, launch: false }]
      }
    });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const result = await runWorkspaceTool(
      new Map([[workspace.id, workspace]]),
      workspace.id,
      'browser_manage_tabs',
      (current) => browserManageTabs(current, { action: 'list_page_tabs_only' }, label),
      (current) => browserManageTabsAuditInvocation(current, 'list_page_tabs_only', label)
    );
    expect(result.content[0].text).toContain('reserved for Threaddex');
    const raw = await readFile(path.join(workspace.realRoot, '.agent/audit/tool_calls.jsonl'), 'utf8');
    const entry = JSON.parse(raw.trim());
    expect(entry.ok).toBe(false);
    expect(entry.metadata).toEqual({ action: 'list_page_tabs_only' });
    expect(entry.summary).toContain('reserved for Threaddex');
    expect(raw).not.toContain(label);
    expect(raw).not.toContain('internal.example');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never persists an unknown caller-provided browser profile label in a failed audit', async () => {
    const label = 'Unconfigured <mailto:user@example.com>';
    const workspace = await browserWorkspace();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const result = await runWorkspaceTool(
      new Map([[workspace.id, workspace]]),
      workspace.id,
      'browser_manage_tabs',
      (current) => browserManageTabs(current, { action: 'list_page_tabs_only' }, label),
      (current) => browserManageTabsAuditInvocation(current, 'list_page_tabs_only', label)
    );
    expect(result.content[0].text).toContain('unknown browser profile');
    const raw = await readFile(path.join(workspace.realRoot, '.agent/audit/tool_calls.jsonl'), 'utf8');
    const entry = JSON.parse(raw.trim());
    expect(entry.ok).toBe(false);
    expect(entry.metadata).toEqual({ action: 'list_page_tabs_only' });
    expect(raw).not.toContain(label);
    expect(raw).not.toContain('user@example.com');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('audits the actual failed browser tool with invocation action/profile', async () => {
    const workspace = await browserWorkspace();
    mockFetch([]);
    const result = await runWorkspaceTool(
      new Map([[workspace.id, workspace]]),
      workspace.id,
      'browser_manage_tabs',
      (current, invocation) => browserManageTabs(current, { action: 'close_by_filter' }, undefined, invocation as ReturnType<typeof browserManageTabsAuditInvocation>),
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

  it('does not count or audit targets with an explicit CDP close success:false', async () => {
    for (const outcomes of [
      [{ result: { success: false } }],
      [{ result: { success: true } }, { result: { success: false } }]
    ]) {
      const workspace = await browserWorkspace({ allow_mouse_keyboard: true });
      mockFetchSequence([
        [
          { id: 'T1', type: 'page', title: 'Private One', url: 'https://example.com/one?secret=a' },
          { id: 'T2', type: 'page', title: 'Private Two', url: 'https://example.com/two?secret=b' }
        ],
        { webSocketDebuggerUrl: 'ws://browser' }
      ]);
      mockCloseResults(outcomes);
      const result = await runWorkspaceTool(
        new Map([[workspace.id, workspace]]),
        workspace.id,
        'browser_manage_tabs',
        (current, invocation) => browserManageTabs(current, { action: 'close_by_filter', url_contains: 'example.com' }, undefined, invocation as ReturnType<typeof browserManageTabsAuditInvocation>),
        (current) => browserManageTabsAuditInvocation(current, 'close_by_filter')
      );
      expect(result.structuredContent.ok).toBe(false);
      expect(result.content[0].text).toContain('browser tab close was not confirmed');
      const raw = await readFile(path.join(workspace.realRoot, '.agent/audit/tool_calls.jsonl'), 'utf8');
      const audit = JSON.parse(raw.trim());
      expect(audit.ok).toBe(false);
      expect(audit.metadata).toEqual(outcomes.length === 1
        ? { profile_label: 'work', action: 'close_by_filter' }
        : { profile_label: 'work', action: 'close_by_filter', target_ids: ['T1'] });
      if (outcomes.length === 1) expect(raw).not.toContain('T1');
      expect(raw).not.toContain('T2');
      expect(raw).not.toContain('secret=a');
      expect(raw).not.toContain('secret=b');
    }
  });

  it('preserves only actually closed target IDs when a later close fails', async () => {
    const workspace = await browserWorkspace({ allow_mouse_keyboard: true });
    mockFetchSequence([
      [
        { id: 'T1', type: 'page', title: 'One', url: 'https://example.com/one?secret=a' },
        { id: 'T2', type: 'page', title: 'Two', url: 'https://example.com/two?secret=b' }
      ],
      { webSocketDebuggerUrl: 'ws://browser' }
    ]);
    mockCloseResults([{ result: { success: true } }, { error: { message: 'forced second close failure' } }]);
    const result = await runWorkspaceTool(
      new Map([[workspace.id, workspace]]),
      workspace.id,
      'browser_manage_tabs',
      (current, invocation) => browserManageTabs(current, { action: 'close_by_filter', url_contains: 'example.com' }, undefined, invocation as ReturnType<typeof browserManageTabsAuditInvocation>),
      (current) => browserManageTabsAuditInvocation(current, 'close_by_filter')
    );
    expect(result.content[0].text).toContain('forced second close failure');
    const raw = await readFile(path.join(workspace.realRoot, '.agent/audit/tool_calls.jsonl'), 'utf8');
    const audit = JSON.parse(raw.trim());
    expect(audit.ok).toBe(false);
    expect(audit.metadata).toEqual({
      profile_label: 'work',
      action: 'close_by_filter',
      target_ids: ['T1']
    });
    expect(audit.metadata.target_ids).not.toContain('T2');
    expect(raw).not.toContain('secret=a');
    expect(raw).not.toContain('secret=b');
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
        thread_id: 'https:example.com',
        conversation_lane: 'mailto:user@example.com',
        lane: 'ya29.a0AfH6SMBfake',
        job_id: 'gho_abcdefghijklmnopqrstuvwxyz',
        threaddex_job_id: 'AKIAABCDEFGHIJKLMNOP',
        correlation_id: 'ghu_abcdefghijklmnopqrstuvwxyz',
        request_id: 'ghs_abcdefghijklmnopqrstuvwxyz',
        source_lane: 'ghr_abcdefghijklmnopqrstuvwxyz',
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
    for (const forbidden of ['https:example.com', 'mailto:user@example.com', 'ya29.', 'gho_', 'ghu_', 'ghs_', 'ghr_', 'AKIA']) {
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

function mockFetchSequence(bodies: unknown[]) {
  let index = 0;
  vi.stubGlobal('fetch', vi.fn(async () => {
    const body = bodies[Math.min(index++, bodies.length - 1)];
    return { ok: true, json: async () => body, text: async () => String(body) };
  }));
}

function mockCloseResults(results: Array<{ result?: unknown; error?: { message: string } }>) {
  let connection = 0;
  class MockWebSocket extends EventTarget {
    close = vi.fn();
    private readonly outcome = results[Math.min(connection++, results.length - 1)];
    constructor(public url: string) {
      super();
      setTimeout(() => this.dispatchEvent(new Event('open')), 0);
    }
    send = vi.fn((message: string) => {
      const id = JSON.parse(message).id;
      const payload = this.outcome.error ? { id, error: this.outcome.error } : { id, result: this.outcome.result };
      setTimeout(() => this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(payload) })), 0);
    });
  }
  vi.stubGlobal('WebSocket', MockWebSocket);
}

async function browserWorkspace(overrides: Partial<Workspace> = {}): Promise<Workspace> {
  return fixtureWorkspace({
    browser: {
      profiles: [{ label: 'work', cdp_host: '127.0.0.1', cdp_port: 9444, headed: true, default: true, launch: false }]
    },
    ...overrides
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
