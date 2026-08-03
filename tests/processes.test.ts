import { createServer, type Server } from 'node:http';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { processKill, processList, processLog, processStart, processStartArgv, processWrite } from '../src/tools/processes.js';
import { shutdownManagedProcesses } from '../src/core/processManager.js';
import { runArgvTailTool } from '../src/tools/runCommand.js';
import { createHttpRequestHandler } from '../src/server/http.js';
import type { AppConfig } from '../src/config/schema.js';
import type { Workspace } from '../src/core/workspaces.js';

const config: AppConfig = {
  server: { host: '127.0.0.1', port: 8765 },
  workspaces: [],
  security: { max_file_bytes: 1000, max_response_bytes: 1000, max_request_bytes: 1000, max_search_results: 10, max_exec_ms: 120000 }
};

describe('process tools', () => {
  it('captures background process output', async () => {
    const workspace = await fixtureWorkspace(true);
    const started = await processStart(config, workspace, 'node background.cjs');
    const processId = String(started.data?.process_id);
    expect(JSON.stringify(processList().data)).toContain(processId);
    await expect(waitForOutput(processId, 'background-ok')).resolves.toContain('background-ok');
  });

  it('starts background processes from canonical argv arrays', async () => {
    const workspace = await fixtureWorkspace(true);
    const started = await processStartArgv(config, workspace, [process.execPath, 'background.cjs']);
    const processId = String(started.data?.process_id);
    expect(started.data).toMatchObject({ command_argv: [process.execPath, 'background.cjs'], timeout_ms: 3600000, tail_supported: true, read_with: 'read_process' });
    await expect(waitForOutput(processId, 'background-ok')).resolves.toContain('background-ok');
  });

  it('records missing executable spawn errors without crashing the gateway', async () => {
    const workspace = await fixtureWorkspace(true);
    const started = await processStartArgv(config, workspace, [`missing-executable-${Date.now()}`]);
    const processId = String(started.data?.process_id);
    const data = await waitForSpawnError(processId);
    expect(data.running).toBe(false);
    expect(data.spawn_error_code).toBe('ENOENT');
    expect(data.output).toContain('spawn_error');
  });

  it('writes stdin to running processes', async () => {
    const workspace = await fixtureWorkspace(true);
    const started = await processStart(config, workspace, 'node stdin.cjs');
    const processId = String(started.data?.process_id);
    processWrite(processId, 'stdin-ok', true);
    await expect(waitForOutput(processId, 'stdin-ok')).resolves.toContain('stdin-ok');
  });

  it('supports cursor-based process output tailing', async () => {
    const workspace = await fixtureWorkspace(true);
    const started = await processStart(config, workspace, 'node tail.cjs');
    const processId = String(started.data?.process_id);
    await expect(waitForOutput(processId, 'first')).resolves.toContain('first');
    const first = processLog(processId).data as { output: string; next_cursor: number; tail_supported: boolean };
    expect(first.tail_supported).toBe(true);
    expect(first.output).toContain('first');
    await waitForOutput(processId, 'second', first.next_cursor);
    const second = processLog(processId, 50000, first.next_cursor).data as { output: string; cursor: number; next_cursor: number };
    expect(second.cursor).toBe(first.next_cursor);
    expect(second.output).toContain('second');
    expect(second.output).not.toContain('first');
  });

  it('reports clamped stale cursors instead of failing silently', async () => {
    const workspace = await fixtureWorkspace(true);
    const started = await processStart(config, workspace, 'node background.cjs');
    const processId = String(started.data?.process_id);
    await expect(waitForOutput(processId, 'background-ok')).resolves.toContain('background-ok');
    const data = processLog(processId, 50000, 9999).data as { cursor: number; next_cursor: number; cursor_clamped: boolean; output: string };
    expect(data.cursor).toBe(data.next_cursor);
    expect(data.cursor_clamped).toBe(true);
    expect(data.output).toBe('');
  });

  it('starts argv run_command work in tail mode', async () => {
    const workspace = await fixtureWorkspace(true);
    const started = await runArgvTailTool(config, workspace, [process.execPath, '-e', "process.stdout.write('tail-mode-ok')"]);
    const processId = String((started.data as { process_id: string }).process_id);
    expect(started.summary).toBe('command started for tailing');
    expect(started.data).toMatchObject({ timeout_ms: 3600000, read_with: 'read_process' });
    await expect(waitForOutput(processId, 'tail-mode-ok')).resolves.toContain('tail-mode-ok');
  });

  it('clamps requested managed-process lifetime to its independent limit', async () => {
    const workspace = await fixtureWorkspace(true);
    const bounded = { ...config, security: { ...config.security, max_process_ms: 600000 } };
    const started = await processStartArgv(bounded, workspace, [process.execPath, 'wait.cjs'], '.', 3600000);
    const processId = String(started.data?.process_id);

    expect(started.data).toMatchObject({ timeout_ms: 600000, running: true });
    expect(processKill(processId).data).toMatchObject({ killed: true });
  });

  it('uses the managed-process default through the HTTP facade', async () => {
    const workspace = await fixtureWorkspace(true);
    const server: Server = createServer(createHttpRequestHandler(httpConfig(workspace)));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('expected TCP address');
      const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/tool`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ operation: 'start_process', arguments: { workspace_id: 'test', cmd_array: [process.execPath, 'wait.cjs'] } })
      });
      const body = await response.json() as { data: { process_id: string; timeout_ms: number } };
      expect(body.data.timeout_ms).toBe(3600000);
      expect(processKill(body.data.process_id).data).toMatchObject({ killed: true });
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('terminates running managed processes during gateway shutdown', async () => {
    const workspace = await fixtureWorkspace(true);
    const started = await processStart(config, workspace, 'node wait.cjs');
    const processId = String(started.data?.process_id);
    const stopped = await shutdownManagedProcesses(10);
    await new Promise((resolve) => setTimeout(resolve, 30));
    const data = processLog(processId).data as { running: boolean; killed: boolean; exit_code: number | null };
    expect(stopped.signaled).toBeGreaterThanOrEqual(1);
    expect(data.killed).toBe(true);
    expect(data.running).toBe(false);
  });

  it('kills running processes', async () => {
    const workspace = await fixtureWorkspace(true);
    const started = await processStart(config, workspace, 'node wait.cjs');
    const processId = String(started.data?.process_id);
    expect(processKill(processId).data).toMatchObject({ killed: true });
  });
});

async function fixtureWorkspace(allowTests: boolean): Promise<Workspace> {
  const root = await mkdtemp(path.join(tmpdir(), 'gtp-process-'));
  await writeFile(path.join(root, 'background.cjs'), "process.stdout.write('background-ok');\n");
  await writeFile(path.join(root, 'stdin.cjs'), 'process.stdin.pipe(process.stdout);\n');
  await writeFile(path.join(root, 'tail.cjs'), "process.stdout.write('first'); setTimeout(() => process.stdout.write('second'), 50);\n");
  await writeFile(path.join(root, 'wait.cjs'), 'setTimeout(() => {}, 30000);\n');
  return { id: 'test', name: 'Test', root, realRoot: root, allow_read: true, allow_write: false, allow_patch: false, allow_tests: allowTests, allow_screen: false, allow_mouse_keyboard: false, browser: { profiles: [] }, commands: {} };
}

async function waitForOutput(processId: string, expected: string, cursor?: number): Promise<string> {
  const deadline = Date.now() + 2500;
  while (Date.now() < deadline) {
    const data = processLog(processId, 50000, cursor).data as { output: string };
    if (data.output.includes(expected)) return data.output;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return (processLog(processId, 50000, cursor).data as { output: string }).output;
}

function httpConfig(workspace: Workspace): AppConfig {
  return {
    ...config,
    server: { host: '127.0.0.1', port: 0, auth: { enabled: false, bearer_token_env: 'TEST_TOKEN', allow_loopback_without_auth: true }, rate_limit: { enabled: false, window_ms: 60000, max_requests: 120, trust_proxy_headers: false }, tool_annotations: { mode: 'honest' }, exposed_tools: [] },
    workspaces: [workspace],
    brokered_executors: { enabled: false, include_action_schema: false, default_ttl_ms: 60000, default_lease_ms: 30000, executors: [] }
  };
}

async function waitForSpawnError(processId: string): Promise<{ running: boolean; spawn_error_code?: string; output: string }> {
  const deadline = Date.now() + 2500;
  while (Date.now() < deadline) {
    const data = processLog(processId).data as { running: boolean; spawn_error_code?: string; output: string };
    if (data.spawn_error_code) return data;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return processLog(processId).data as { running: boolean; spawn_error_code?: string; output: string };
}
