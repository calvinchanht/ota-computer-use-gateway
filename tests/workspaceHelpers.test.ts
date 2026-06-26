import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { workspaceHelperList, workspaceHelperRun, workspaceHelperStatus, workspaceHelperUpsert } from '../src/tools/workspaceHelpers.js';
import type { AppConfig } from '../src/config/schema.js';
import type { Workspace } from '../src/core/workspaces.js';

const config: AppConfig = {
  server: { host: '127.0.0.1', port: 8765 },
  workspaces: [],
  command_runtime: { preferred_shell: 'platform-default' },
  brokered_executors: { enabled: false, executors: [] },
  security: { max_file_bytes: 1000, max_response_bytes: 1000, max_request_bytes: 1000, max_search_results: 10, max_exec_ms: 120000 }
} as AppConfig;

describe('workspace helpers', () => {
  it('creates, lists, and reads a constrained helper definition', async () => {
    const workspace = await fixtureWorkspace({ allow_write: true, allow_tests: true });
    await workspaceHelperUpsert(config, workspace, {
      helper_id: 'mickey_chrome',
      mode: 'start',
      kind: 'ssh_systemd_user_service',
      target_host_id: 'cortex',
      target_user: 'molt',
      service_unit: 'threaddex-mickey-browser.service',
      post_checks: [{ kind: 'http_json', url: 'http://127.0.0.1:33388/json/version', expect_status: 200 }]
    });

    const list = await workspaceHelperList(config, workspace);
    expect(JSON.stringify(list.data)).toContain('mickey_chrome');

    const status = await workspaceHelperStatus(config, workspace, 'mickey_chrome', 'start');
    expect(status.data).toMatchObject({ configured: true });

    const raw = await readFile(path.join(workspace.realRoot, '.agent/workspace-helpers.json'), 'utf8');
    expect(raw).toContain('workspace-helpers/v1');
  });

  it('rejects arbitrary helper ids and non-local http checks', async () => {
    const workspace = await fixtureWorkspace({ allow_write: true, allow_tests: true });
    await expect(workspaceHelperUpsert(config, workspace, {
      helper_id: '../bad',
      mode: 'start',
      kind: 'host_health_check'
    })).rejects.toThrow();

    await expect(workspaceHelperUpsert(config, workspace, {
      helper_id: 'mickey_chrome',
      mode: 'start',
      kind: 'ssh_systemd_user_service',
      target_host_id: 'cortex',
      target_user: 'molt',
      service_unit: 'threaddex-mickey-browser.service',
      post_checks: [{ kind: 'http_json', url: 'https://example.com/status', expect_status: 200 }]
    })).rejects.toThrow(/local loopback/);
  });

  it('requires write permission for helper upsert and test permission for helper run', async () => {
    const readOnly = await fixtureWorkspace({ allow_write: false, allow_tests: true });
    await expect(workspaceHelperUpsert(config, readOnly, { helper_id: 'repo_checks', mode: 'build', kind: 'repo_build_test', repo: '.', checks: ['build'] })).rejects.toThrow(/does not allow/);

    const noRun = await fixtureWorkspace({ allow_write: true, allow_tests: false });
    await workspaceHelperUpsert(config, noRun, { helper_id: 'repo_checks', mode: 'build', kind: 'repo_build_test', repo: '.', checks: ['build'] });
    await expect(workspaceHelperRun(config, noRun, 'repo_checks', 'build')).rejects.toThrow(/does not allow/);
  });

  it('rejects systemd helper execution outside the current local user', async () => {
    const workspace = await fixtureWorkspace({ allow_write: true, allow_tests: true });
    await workspaceHelperUpsert(config, workspace, {
      helper_id: 'mickey_chrome',
      mode: 'start',
      kind: 'ssh_systemd_user_service',
      target_host_id: 'cortex',
      target_user: 'molt',
      service_unit: 'threaddex-mickey-browser.service'
    });
    await expect(workspaceHelperRun(config, workspace, 'mickey_chrome', 'start')).rejects.toThrow(/local-user only/);
  });
});

async function fixtureWorkspace(flags: { allow_write: boolean; allow_tests: boolean }): Promise<Workspace> {
  const root = await mkdtemp(path.join(tmpdir(), 'ota-helper-'));
  return {
    id: 'test', name: 'Test', root, realRoot: root, realAgentDir: path.join(root, '.agent'),
    allow_read: true, allow_write: flags.allow_write, allow_patch: false, allow_tests: flags.allow_tests,
    allow_screen: false, allow_mouse_keyboard: false, browser: { profiles: [] }, commands: {},
    filesystem: { host_root: '/' }, git: { github_cli: 'gh' }, windows_computer: { enabled: false, allow_screenshot: false, allow_uia_tree: false, allow_mouse: false, allow_keyboard: false, allow_clipboard: false, allow_window_management: false, allow_app_launch: false, allow_process_attach: false, allow_multi_monitor: true }
  } as Workspace;
}
