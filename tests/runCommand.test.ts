import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runArgvTool, runConfiguredCommand, runShellTool } from '../src/tools/runCommand.js';
import { runCommandCmdArray } from '../src/server/http.js';
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

  it('runs Threaddex job lifecycle shell commands with a native-API warning tip', async () => {
    const workspace = await fixtureWorkspace(true);
    const result = await runShellTool(config, workspace, "node -e \"process.stdout.write('ok')\" # curl https://mickey-api.unrealize.com/threaddex/v1/job/job_1/deliver");
    expect(result.ok).toBe(true);
    expect(JSON.stringify(result.data)).toContain('ok');
    expect(JSON.stringify(result.warnings)).toContain('native /threaddex Action operations');
  });

  it('runs legacy query-style Job API lifecycle argv commands with a native-API warning tip', async () => {
    const workspace = await fixtureWorkspace(true);
    const result = await runArgvTool(config, workspace, [process.execPath, '-e', "process.stdout.write(process.argv[1])", 'https://threaddex.example/v1/job/deliver?job_id=job_1']);
    expect(result.ok).toBe(true);
    expect(JSON.stringify(result.data)).toContain('threaddex.example');
    expect(JSON.stringify(result.warnings)).toContain('native /threaddex Action operations');
  });

  it('allows inert lifecycle mentions in issue-body and search workflows', async () => {
    const workspace = await fixtureWorkspace(true);
    await expect(runShellTool(config, workspace, "grep -RIn '/v1/job/job_1/continuation' docs tests || true")).resolves.toBeTruthy();
    await expect(runShellTool(config, workspace, "cat > issue.md <<'EOF'\n/v1/job/job_1/continuation returned checkpoint_required\nEOF\ncat issue.md")).resolves.toBeTruthy();
    await expect(runArgvTool(config, workspace, ['gh', 'issue', 'create', '--title', 'doc', '--body-file', 'issue.md'])).resolves.toBeTruthy();
  });

  it('runs executable lifecycle-looking calls while returning a native-API warning tip', async () => {
    const workspace = await fixtureWorkspace(true);
    const result = await runShellTool(config, workspace, "node -e \"process.stdout.write('ok'); /* fetch('https://example.unrealize.com/threaddex/v1/job/job_1/deliver', {method:'POST'}) */\"");
    expect(result.ok).toBe(true);
    expect(JSON.stringify(result.data)).toContain('ok');
    expect(JSON.stringify(result.warnings)).toContain('native /threaddex Action operations');
  });

  it('still allows ordinary non-lifecycle HTTP probes through run_command', async () => {
    const workspace = await fixtureWorkspace(true);
    const result = await runArgvTool(config, workspace, [process.execPath, '-e', "process.stdout.write('probe-ok')"]);
    expect(JSON.stringify(result.data)).toContain('probe-ok');
  });

  it('preserves JSON-looking argv values without shell re-encoding', async () => {
    const workspace = await fixtureWorkspace(true);
    const payload = '{"quoted":"a b","slash":"c\\\\d"}';
    const result = await runArgvTool(config, workspace, [process.execPath, '-e', 'process.stdout.write(process.argv[1])', payload]);
    expect((result.data as { stdout: string }).stdout).toBe(payload);
  });

  it('reports command timeouts explicitly', async () => {
    const workspace = await fixtureWorkspace(true);
    const result = await runArgvTool(config, workspace, [process.execPath, '-e', 'setTimeout(() => {}, 1000)'], '.', 1);
    expect(result.data).toMatchObject({ timed_out: true });
  });

});



describe('HTTP run_command argv shape', () => {
  it('accepts preferred cmd_array', () => {
    expect(runCommandCmdArray({ cmd_array: ['git', 'status', '--short'] })).toEqual(['git', 'status', '--short']);
  });

  it('keeps legacy cmd array compatibility', () => {
    expect(runCommandCmdArray({ cmd: ['git', 'status', '--short'] })).toEqual(['git', 'status', '--short']);
  });

  it('rejects string cmd with a shell-string hint', () => {
    expect(() => runCommandCmdArray({ cmd: 'git status --short' })).toThrow(/Use cmd_array/);
  });

  it('rejects conflicting cmd_array and cmd values', () => {
    expect(() => runCommandCmdArray({ cmd_array: ['git', 'status'], cmd: ['git', 'diff'] })).toThrow(/cmd_array\/cmd conflict/);
  });
});

async function fixtureWorkspace(allowTests: boolean): Promise<Workspace> {
  const root = await mkdtemp(path.join(tmpdir(), 'gtp-command-'));
  await writeFile(path.join(root, 'hello.cjs'), "process.stdout.write('hello');\n");
  await writeFile(path.join(root, 'shell-ok.cjs'), "process.stdout.write('shell-ok');\n");
  return { id: 'test', name: 'Test', root, realRoot: root, allow_read: true, allow_write: false, allow_patch: false, allow_tests: allowTests, allow_screen: false, allow_mouse_keyboard: false, browser: { profiles: [] }, commands: { echo: 'node hello.cjs' } };
}
