import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../src/config/schema.js';
import type { PlatformKind } from '../src/core/platform.js';
import type { Workspace } from '../src/core/workspaces.js';
import { createServer } from '../src/server/create.js';
import { BROWSER_TOOL_NAMES, CANONICAL_PROVIDER_TOOL_NAMES, MAC_COMPUTER_TOOL_NAMES, MEMORY_LIFECYCLE_TOOL_NAMES, WINDOWS_COMPUTER_TOOL_NAMES } from '../src/tools/actionSurface.js';
import { allowedTools, effectiveApiSets, workspacePolicy } from '../src/tools/policy.js';

const platforms: PlatformKind[] = ['linux', 'macos', 'windows'];

describe('role x host OS action surface matrix', () => {
  it('keeps every policy-visible action in the canonical provider manifest', () => {
    for (const platform of platforms) {
      for (const workspace of profiles()) {
        const allowed = allowedTools(workspace, platform);
        for (const tool of allowed) expect(CANONICAL_PROVIDER_TOOL_NAMES, `${platform}/${workspace.name}: ${tool}`).toContain(tool);
      }
    }
  });

  it('registers every canonical provider action in MCP', async () => {
    const workspace = fullWorkspace({ ota_memory: { enabled: false } as any });
    const server = await createServer(config(workspace));
    const registered = Object.keys((server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools);
    for (const tool of CANONICAL_PROVIDER_TOOL_NAMES) expect(registered, tool).toContain(tool);
  });

  it('makes macOS and Windows computer roles host-specific while browser stays cross-platform', () => {
    const workspace = fullWorkspace();
    for (const platform of platforms) {
      const tools = allowedTools(workspace, platform);
      expect(tools).toEqual(expect.arrayContaining([...BROWSER_TOOL_NAMES]));
      if (platform === 'macos') {
        expect(tools).toEqual(expect.arrayContaining([...MAC_COMPUTER_TOOL_NAMES]));
        for (const tool of WINDOWS_COMPUTER_TOOL_NAMES) expect(tools).not.toContain(tool);
      } else if (platform === 'windows') {
        expect(tools).toEqual(expect.arrayContaining([...WINDOWS_COMPUTER_TOOL_NAMES]));
        for (const tool of MAC_COMPUTER_TOOL_NAMES) expect(tools).not.toContain(tool);
      } else {
        for (const tool of [...MAC_COMPUTER_TOOL_NAMES, ...WINDOWS_COMPUTER_TOOL_NAMES]) expect(tools).not.toContain(tool);
      }
    }
  });

  it('reports configured OS-incompatible role flags instead of advertising unusable actions', () => {
    const workspace = fullWorkspace();
    expect(effectiveApiSets(workspace, 'linux')).toMatchObject({ computer: false, computer_windows: false });
    const policy = workspacePolicy(workspace, undefined, 'linux').data;
    expect(policy?.api_set_incompatibilities).toEqual(expect.arrayContaining([
      expect.stringContaining('api_sets.computer requires macOS'),
      expect.stringContaining('api_sets.computer_windows requires Windows')
    ]));
  });

  it('keeps lifecycle memory tools registered even through a stale exposed-tools snapshot', async () => {
    const workspace = fullWorkspace({ ota_memory: { enabled: false } as any });
    const cfg = config(workspace);
    cfg.server.exposed_tools = ['read_file'];
    const server = await createServer(cfg);
    const registered = Object.keys((server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools);
    expect(registered).toContain('read_file');
    expect(registered).toEqual(expect.arrayContaining([...MEMORY_LIFECYCLE_TOOL_NAMES]));
    expect(registered).not.toContain('windows_screenshot');
  });

  it('keeps the stable OTA-Memory lifecycle interface on every profile before and after backend cutover', () => {
    const disabled = fullWorkspace({ ota_memory: { enabled: false } as any });
    const enabled = fullWorkspace();
    for (const platform of platforms) {
      expect(allowedTools(disabled, platform)).toEqual(expect.arrayContaining([...MEMORY_LIFECYCLE_TOOL_NAMES]));
      expect(allowedTools(enabled, platform)).toEqual(expect.arrayContaining([...MEMORY_LIFECYCLE_TOOL_NAMES]));
      expect(allowedTools(disabled, platform)).toEqual(expect.arrayContaining(['memory_search', 'memory_write']));
      expect(allowedTools(enabled, platform)).not.toContain('memory_search');
      expect(allowedTools(enabled, platform)).not.toContain('memory_write');
    }
  });
});

function profiles(): Workspace[] {
  return [
    fullWorkspace(),
    fullWorkspace({ api_sets: { workspace: true, browser: false, computer: false, computer_windows: false, machine_admin: false, estate_admin: false } }),
    fullWorkspace({ api_sets: { workspace: true, browser: true, computer: false, computer_windows: false, machine_admin: true, estate_admin: false } })
  ];
}

function fullWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: 'test', name: 'Full role fixture', root: '/tmp', realRoot: '/tmp', allow_read: true, allow_write: true,
    allow_patch: true, allow_tests: true, allow_screen: true, allow_mouse_keyboard: true,
    api_sets: { workspace: true, browser: true, computer: true, computer_windows: true, machine_admin: true, estate_admin: true },
    browser: { profiles: [] }, commands: {}, filesystem: { machine_admin_host_scope: true, host_root: '/' },
    windows_computer: { enabled: true, allow_screenshot: true, allow_uia_tree: true, allow_mouse: true, allow_keyboard: true, allow_clipboard: true, allow_window_management: true, allow_app_launch: true, allow_process_attach: true, allow_multi_monitor: true },
    ota_memory: { enabled: true, python_executable: 'python', package_root: '/tmp/ota-memory', database_path: '/tmp/ota-memory.sqlite3', project_id: 'test', workspace_id: 'test', agent_id: 'test', user_id: '', scope_type: 'project', privacy: 'project_only', timeout_ms: 30000 },
    ...overrides
  };
}

function config(workspace: Workspace): AppConfig {
  return {
    server: { host: '127.0.0.1', port: 8765, auth: { enabled: false, bearer_token_env: 'X', allow_loopback_without_auth: true }, rate_limit: { enabled: false, window_ms: 60000, max_requests: 120, trust_proxy_headers: false }, tool_annotations: { mode: 'honest' }, exposed_tools: [] },
    workspaces: [workspace], brokered_executors: { enabled: false, include_action_schema: false, default_ttl_ms: 60000, default_lease_ms: 30000, executors: [] },
    security: { max_file_bytes: 200000, max_response_bytes: 50000, max_request_bytes: 1000000, max_search_results: 50, max_exec_ms: 120000 }
  } as AppConfig;
}
