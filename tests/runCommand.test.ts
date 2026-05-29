import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { recordApproval } from '../src/core/approval.js';
import { runConfiguredCommand, runShellTool } from '../src/tools/runCommand.js';
import type { AppConfig } from '../src/config/schema.js';
import type { Workspace } from '../src/core/workspaces.js';

const config: AppConfig = {
  server: { host: '127.0.0.1', port: 8765 },
  workspaces: [],
  security: { max_file_bytes: 1000, max_response_bytes: 1000, max_request_bytes: 1000, max_search_results: 10, max_exec_ms: 120000, denied_globs: [] }
};

describe('runConfiguredCommand', () => {
  it('requires workspace command execution permission', async () => {
    const workspace = await fixtureWorkspace(false);
    await expect(runConfiguredCommand(workspace, 'echo')).rejects.toThrow('does not allow');
  });

  it('requires approval for command id', async () => {
    const workspace = await fixtureWorkspace(true);
    await expect(runConfiguredCommand(workspace, 'echo')).rejects.toThrow('missing approval');
  });

  it('runs approved allowlisted commands', async () => {
    const workspace = await fixtureWorkspace(true);
    await recordApproval(workspace, { id: 'ok', action: 'run_command:echo', created_at: new Date().toISOString() });
    const result = await runConfiguredCommand(workspace, 'echo');
    expect(JSON.stringify(result.data)).toContain('hello');
  });

  it('runs approved shell commands', async () => {
    const workspace = await fixtureWorkspace(true);
    await recordApproval(workspace, { id: 'ok', action: 'run_command', created_at: new Date().toISOString() });
    const result = await runShellTool(config, workspace, 'printf shell-ok');
    expect(JSON.stringify(result.data)).toContain('shell-ok');
  });
});

async function fixtureWorkspace(allowTests: boolean): Promise<Workspace> {
  const root = await mkdtemp(path.join(tmpdir(), 'gtp-command-'));
  return { id: 'test', name: 'Test', root, realRoot: root, allow_read: true, allow_write: false, allow_patch: false, allow_tests: allowTests, allow_screen: false, allow_mouse_keyboard: false, commands: { echo: 'printf hello' } };
}
