import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
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

  it('runs allowlisted commands without local approval markers', async () => {
    const workspace = await fixtureWorkspace(true);
    const result = await runConfiguredCommand(workspace, 'echo');
    expect(JSON.stringify(result.data)).toContain('hello');
  });

  it('runs scoped shell commands without local approval markers', async () => {
    const workspace = await fixtureWorkspace(true);
    const result = await runShellTool(config, workspace, 'node shell-ok.cjs');
    expect(JSON.stringify(result.data)).toContain('shell-ok');
  });
});

async function fixtureWorkspace(allowTests: boolean): Promise<Workspace> {
  const root = await mkdtemp(path.join(tmpdir(), 'gtp-command-'));
  await writeFile(path.join(root, 'hello.cjs'), "process.stdout.write('hello');\n");
  await writeFile(path.join(root, 'shell-ok.cjs'), "process.stdout.write('shell-ok');\n");
  return { id: 'test', name: 'Test', root, realRoot: root, allow_read: true, allow_write: false, allow_patch: false, allow_tests: allowTests, allow_screen: false, allow_mouse_keyboard: false, browser: { profiles: [] }, commands: { echo: 'node hello.cjs' } };
}
