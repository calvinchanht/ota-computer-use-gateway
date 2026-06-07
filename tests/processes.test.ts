import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { processKill, processList, processLog, processStart, processWrite } from '../src/tools/processes.js';
import { runArgvTailTool } from '../src/tools/runCommand.js';
import type { AppConfig } from '../src/config/schema.js';
import type { Workspace } from '../src/core/workspaces.js';

const config: AppConfig = {
  server: { host: '127.0.0.1', port: 8765 },
  workspaces: [],
  security: { max_file_bytes: 1000, max_response_bytes: 1000, max_request_bytes: 1000, max_search_results: 10, max_exec_ms: 120000, denied_globs: [] }
};

describe('process tools', () => {
  it('captures background process output', async () => {
    const workspace = await fixtureWorkspace(true);
    const started = await processStart(config, workspace, 'printf background-ok');
    const processId = String(started.data?.process_id);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(JSON.stringify(processList().data)).toContain(processId);
    expect(JSON.stringify(processLog(processId).data)).toContain('background-ok');
  });

  it('writes stdin to running processes', async () => {
    const workspace = await fixtureWorkspace(true);
    const started = await processStart(config, workspace, 'cat');
    const processId = String(started.data?.process_id);
    processWrite(processId, 'stdin-ok', true);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(JSON.stringify(processLog(processId).data)).toContain('stdin-ok');
  });

  it('supports cursor-based process output tailing', async () => {
    const workspace = await fixtureWorkspace(true);
    const started = await processStart(config, workspace, 'printf first; sleep 0.05; printf second');
    const processId = String(started.data?.process_id);
    await new Promise((resolve) => setTimeout(resolve, 30));
    const first = processLog(processId).data as { output: string; next_cursor: number; tail_supported: boolean };
    expect(first.tail_supported).toBe(true);
    expect(first.output).toContain('first');
    await new Promise((resolve) => setTimeout(resolve, 80));
    const second = processLog(processId, 50000, first.next_cursor).data as { output: string; cursor: number; next_cursor: number };
    expect(second.cursor).toBe(first.next_cursor);
    expect(second.output).toContain('second');
    expect(second.output).not.toContain('first');
  });

  it('starts argv run_command work in tail mode', async () => {
    const workspace = await fixtureWorkspace(true);
    const started = await runArgvTailTool(config, workspace, ['bash', '-lc', 'printf tail-mode-ok']);
    const processId = String((started.data as { process_id: string }).process_id);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(started.summary).toBe('command started for tailing');
    expect(JSON.stringify(started.data)).toContain('read_process');
    expect(JSON.stringify(processLog(processId).data)).toContain('tail-mode-ok');
  });

  it('kills running processes', async () => {
    const workspace = await fixtureWorkspace(true);
    const started = await processStart(config, workspace, 'sleep 30');
    const processId = String(started.data?.process_id);
    expect(processKill(processId).data).toMatchObject({ killed: true });
  });
});

async function fixtureWorkspace(allowTests: boolean): Promise<Workspace> {
  const root = await mkdtemp(path.join(tmpdir(), 'gtp-process-'));
  return { id: 'test', name: 'Test', root, realRoot: root, allow_read: true, allow_write: false, allow_patch: false, allow_tests: allowTests, allow_screen: false, allow_mouse_keyboard: false, browser: { profiles: [] }, commands: {} };
}
