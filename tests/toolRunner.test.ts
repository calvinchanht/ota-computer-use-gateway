import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { toolAuditMetadata } from '../src/core/audit.js';
import { runWorkspaceTool } from '../src/core/toolRunner.js';
import { ok } from '../src/core/result.js';
import type { Workspace } from '../src/core/workspaces.js';

describe('runWorkspaceTool', () => {
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

  it('keeps browser list audit metadata non-mutating', () => {
    expect(toolAuditMetadata('browser_manage_tabs', {
      profile_label: 'rosebot-browser',
      action: 'list_page_tabs_only',
      targets: [{ id: 'TARGET-1' }]
    })).toEqual({
      profile_label: 'rosebot-browser',
      action: 'list_page_tabs_only'
    });
  });

  it('allowlists API caller and correlation context without persisting URLs', () => {
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

  it('keeps failed tool calls auditable', async () => {
    const workspace = await fixtureWorkspace();
    await runWorkspaceTool(new Map([[workspace.id, workspace]]), workspace.id, 'browser_manage_tabs', async () => {
      throw new Error('close failed');
    });
    const audit = await readAudit(workspace);
    expect(audit.tool).toBe('browser_manage_tabs');
    expect(audit.ok).toBe(false);
    expect(audit.summary).toBe('close failed');
  });

  it('blocks tools when panic stop is active', async () => {
    const workspace = await fixtureWorkspace();
    await mkdir(path.join(workspace.realRoot, '.agent'), { recursive: true });
    await writeFile(path.join(workspace.realRoot, '.agent/PANIC_STOP'), 'stop');
    const result = await runWorkspaceTool(new Map([[workspace.id, workspace]]), workspace.id, 'read_file', async () => ok('done'));
    expect(result.content[0].text).toContain('panic stop');
  });
});

async function readAudit(workspace: Workspace): Promise<Record<string, unknown>> {
  const audit = await readFile(path.join(workspace.realRoot, '.agent/audit/tool_calls.jsonl'), 'utf8');
  return JSON.parse(audit.trim());
}

async function fixtureWorkspace(): Promise<Workspace> {
  const root = await mkdtemp(path.join(tmpdir(), 'gtp-runner-'));
  return { id: 'test', name: 'Test', root, realRoot: root, allow_read: true, allow_write: false, allow_patch: false, allow_tests: false, allow_screen: false, allow_mouse_keyboard: false, browser: { profiles: [] }, commands: {} };
}
