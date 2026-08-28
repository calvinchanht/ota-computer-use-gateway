import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir, userInfo } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  executeWindowsOtaDeployment,
  WINDOWS_OTA_DEPLOY_MODE,
  WINDOWS_OTA_DEPLOY_PROFILE,
  WINDOWS_OTA_DEPLOY_REPO,
  WINDOWS_OTA_PRE_LIVE_MARKER,
  WINDOWS_OTA_SOURCE_REVISION,
  WINDOWS_OTA_SOURCE_TREE,
  WINDOWS_OTA_TARGET_PRINCIPAL,
  WINDOWS_OTA_TARGET_SID,
  WINDOWS_OTA_TARGET_USER
} from '../src/tools/windowsOtaDeploy.js';
import { workspaceHelperList, workspaceHelperRun, workspaceHelperStatus, workspaceHelperUpsert } from '../src/tools/workspaceHelpers.js';

vi.mock('../src/tools/windowsOtaDeploy.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/tools/windowsOtaDeploy.js')>();
  return {
    ...actual,
    executeWindowsOtaDeployment: vi.fn(async () => ({ ok: true, summary: 'mock fixed Windows OTA executor', data: { executed: true }, truncated: false, warnings: [] }))
  };
});
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
  const originalLocalHostId = process.env.OTA_LOCAL_HOST_ID;

  beforeEach(() => {
    process.env.OTA_LOCAL_HOST_ID = 'rosebot-win';
    vi.mocked(executeWindowsOtaDeployment).mockClear();
  });

  afterEach(() => {
    if (originalLocalHostId === undefined) delete process.env.OTA_LOCAL_HOST_ID;
    else process.env.OTA_LOCAL_HOST_ID = originalLocalHostId;
  });

  it('creates, lists, and reads a constrained helper definition', async () => {
    const workspace = await fixtureWorkspace({ allow_write: true, allow_tests: true, machine_admin: true });
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
    const workspace = await fixtureWorkspace({ allow_write: true, allow_tests: true, machine_admin: true });
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

  it('rejects systemd helpers for non-machine-admin workspaces', async () => {
    const workspace = await fixtureWorkspace({ allow_write: true, allow_tests: true });
    await expect(workspaceHelperUpsert(config, workspace, {
      helper_id: 'local_service', mode: 'restart', kind: 'ssh_systemd_user_service',
      target_host_id: 'localhost', target_user: userInfo().username, service_unit: 'sensitive.service'
    })).rejects.toThrow(/machine_admin/);
  });

  it('does not let callers expand a repo helper beyond its configured checks', async () => {
    const workspace = await fixtureWorkspace({ allow_write: true, allow_tests: true });
    await workspaceHelperUpsert(config, workspace, { helper_id: 'repo_checks', mode: 'test', kind: 'repo_build_test', repo: '.', checks: ['test'] });
    await expect(workspaceHelperRun(config, workspace, 'repo_checks', 'test', { checks: ['build'] })).rejects.toThrow(/no allowed checks/);
  });

  it('requires write permission for helper upsert and test permission for helper run', async () => {
    const readOnly = await fixtureWorkspace({ allow_write: false, allow_tests: true });
    await expect(workspaceHelperUpsert(config, readOnly, { helper_id: 'repo_checks', mode: 'build', kind: 'repo_build_test', repo: '.', checks: ['build'] })).rejects.toThrow(/does not allow/);

    const noRun = await fixtureWorkspace({ allow_write: true, allow_tests: false });
    await workspaceHelperUpsert(config, noRun, { helper_id: 'repo_checks', mode: 'build', kind: 'repo_build_test', repo: '.', checks: ['build'] });
    await expect(workspaceHelperRun(config, noRun, 'repo_checks', 'build')).rejects.toThrow(/does not allow/);
  });

  it('rejects systemd helper execution outside the current local user', async () => {
    const workspace = await fixtureWorkspace({ allow_write: true, allow_tests: true, machine_admin: true });
    await workspaceHelperUpsert(config, workspace, {
      helper_id: 'mickey_chrome',
      mode: 'start',
      kind: 'ssh_systemd_user_service',
      target_host_id: 'cortex',
      target_user: userInfo().username,
      service_unit: 'threaddex-mickey-browser.service'
    });
    await expect(workspaceHelperRun(config, workspace, 'mickey_chrome', 'start')).rejects.toThrow(/local-user only/);
  });

  it('stores only the exact fixed repo_deploy_to_host profile and dispatches only the fixed Windows OTA executor', async () => {
    const workspace = await fixtureWorkspace({ allow_write: true, allow_tests: true, machine_admin: true });
    await workspaceHelperUpsert(config, workspace, fixedRepoDeploy());

    const status = await workspaceHelperStatus(config, workspace, 'game247_gateway_deploy', WINDOWS_OTA_DEPLOY_MODE);
    expect(status.data).toMatchObject({
      configured: true,
      helper: {
        kind: 'repo_deploy_to_host',
        repo: WINDOWS_OTA_DEPLOY_REPO,
        target_host_id: 'rosebot-win',
        target_user: WINDOWS_OTA_TARGET_USER,
        deployment_profile: WINDOWS_OTA_DEPLOY_PROFILE,
        source_revision: WINDOWS_OTA_SOURCE_REVISION,
        source_tree: WINDOWS_OTA_SOURCE_TREE,
        target_principal: WINDOWS_OTA_TARGET_PRINCIPAL,
        target_sid: WINDOWS_OTA_TARGET_SID,
        expected_live_marker: WINDOWS_OTA_PRE_LIVE_MARKER
      }
    });

    const result = await workspaceHelperRun(config, workspace, 'game247_gateway_deploy', WINDOWS_OTA_DEPLOY_MODE);
    expect(result).toMatchObject({ ok: true, summary: 'mock fixed Windows OTA executor' });
    expect(executeWindowsOtaDeployment).toHaveBeenCalledTimes(1);
  });

  it('requires machine_admin and the exact server-owned local host binding for repo_deploy_to_host', async () => {
    const noAdmin = await fixtureWorkspace({ allow_write: true, allow_tests: true });
    await expect(workspaceHelperUpsert(config, noAdmin, fixedRepoDeploy())).rejects.toThrow(/machine_admin/);

    const admin = await fixtureWorkspace({ allow_write: true, allow_tests: true, machine_admin: true });
    await expect(workspaceHelperUpsert(config, admin, fixedRepoDeploy({ target_host_id: 'remote-host' }))).rejects.toThrow(/exact local host binding/);

    delete process.env.OTA_LOCAL_HOST_ID;
    await expect(workspaceHelperUpsert(config, admin, fixedRepoDeploy())).rejects.toThrow(/server-owned OTA_LOCAL_HOST_ID binding/);
  });

  it.each([
    ['mode', { mode: 'restart' }, /mode must be deploy/],
    ['repo', { repo: 'calvinchanht/other' }, /repo does not match/],
    ['target user', { target_user: 'other' }, /target_user does not match/],
    ['profile', { deployment_profile: undefined }, /deployment_profile mismatch/],
    ['revision', { source_revision: undefined }, /source_revision mismatch/],
    ['tree', { source_tree: undefined }, /source_tree mismatch/],
    ['principal', { target_principal: undefined }, /target_principal mismatch/],
    ['SID', { target_sid: undefined }, /target_sid mismatch/],
    ['pre-live marker', { expected_live_marker: undefined }, /expected_live_marker mismatch/],
    ['checks', { checks: ['build'] }, /does not accept checks/],
    ['post checks', { post_checks: [{ kind: 'command_status' }] }, /does not accept checks/],
    ['service unit', { service_unit: 'forbidden.service' }, /does not accept checks/]
  ])('rejects repo_deploy_to_host fixed-profile drift in %s', async (_name, override, error) => {
    const workspace = await fixtureWorkspace({ allow_write: true, allow_tests: true, machine_admin: true });
    await expect(workspaceHelperUpsert(config, workspace, fixedRepoDeploy(override))).rejects.toThrow(error);
    expect(executeWindowsOtaDeployment).not.toHaveBeenCalled();
  });

  it('rejects unknown transaction fields and fixed deploy fields on other helper kinds', async () => {
    const workspace = await fixtureWorkspace({ allow_write: true, allow_tests: true, machine_admin: true });
    await expect(workspaceHelperUpsert(config, workspace, { ...fixedRepoDeploy(), command: 'whoami' })).rejects.toThrow();
    await expect(workspaceHelperUpsert(config, workspace, {
      helper_id: 'repo_checks', mode: 'test', kind: 'repo_build_test', repo: '.', checks: ['test'], deployment_profile: WINDOWS_OTA_DEPLOY_PROFILE
    })).rejects.toThrow(/only valid for repo_deploy_to_host/);
  });

  it.each([
    ['command', { command: 'whoami' }],
    ['script', { script: 'Write-Host widened' }],
    ['executable path', { executable: 'C:\\Windows\\System32\\cmd.exe' }],
    ['argv', { argv: ['-c', 'widened'] }],
    ['filesystem path', { cwd: 'D:\\Other' }],
    ['secret', { token: 'not-a-real-token' }],
    ['service control', { service: 'Stop-Service rosebot-ota-gateway' }]
  ])('rejects nonempty repo_deploy_to_host execution args: %s', async (_name, args) => {
    const workspace = await fixtureWorkspace({ allow_write: true, allow_tests: true, machine_admin: true });
    await workspaceHelperUpsert(config, workspace, fixedRepoDeploy());
    await expect(workspaceHelperRun(config, workspace, 'game247_gateway_deploy', WINDOWS_OTA_DEPLOY_MODE, args)).rejects.toThrow(/does not accept execution args/);
    expect(executeWindowsOtaDeployment).not.toHaveBeenCalled();
  });
});

async function fixtureWorkspace(flags: { allow_write: boolean; allow_tests: boolean; machine_admin?: boolean }): Promise<Workspace> {
  const root = await mkdtemp(path.join(tmpdir(), 'ota-helper-'));
  return {
    id: 'test', name: 'Test', root, realRoot: root, realAgentDir: path.join(root, '.agent'),
    allow_read: true, allow_write: flags.allow_write, allow_patch: false, allow_tests: flags.allow_tests,
    allow_screen: false, allow_mouse_keyboard: false, api_sets: flags.machine_admin ? { machine_admin: true } : {}, browser: { profiles: [] }, commands: {},
    filesystem: { host_root: '/' }, git: { github_cli: 'gh' }, windows_computer: { enabled: false, allow_screenshot: false, allow_uia_tree: false, allow_mouse: false, allow_keyboard: false, allow_clipboard: false, allow_window_management: false, allow_app_launch: false, allow_process_attach: false, allow_multi_monitor: true }
  } as Workspace;
}

function fixedRepoDeploy(overrides: Record<string, unknown> = {}) {
  return {
    helper_id: 'game247_gateway_deploy',
    mode: WINDOWS_OTA_DEPLOY_MODE,
    kind: 'repo_deploy_to_host',
    repo: WINDOWS_OTA_DEPLOY_REPO,
    checks: [],
    target_host_id: 'rosebot-win',
    target_user: WINDOWS_OTA_TARGET_USER,
    post_checks: [],
    deployment_profile: WINDOWS_OTA_DEPLOY_PROFILE,
    source_revision: WINDOWS_OTA_SOURCE_REVISION,
    source_tree: WINDOWS_OTA_SOURCE_TREE,
    target_principal: WINDOWS_OTA_TARGET_PRINCIPAL,
    target_sid: WINDOWS_OTA_TARGET_SID,
    expected_live_marker: WINDOWS_OTA_PRE_LIVE_MARKER,
    ...overrides
  };
}
