import { ok } from '../core/result.js';
import { commandRuntimeInfo } from '../core/commandAdapter.js';
import type { Workspace } from '../core/workspaces.js';
import { platformKind, type PlatformKind } from '../core/platform.js';
import { conservativeCensoringEnabled, environmentFilteringEnabled, resultSanitizationEnabled, secretContentHeuristicsEnabled, secretValueRedactionEnabled, type AppConfig } from '../config/schema.js';
import { workspaceChildEnvironmentMode } from '../core/securityPolicy.js';
import { BASE_TOOL_NAMES, BROWSER_TOOL_NAMES, ESTATE_ADMIN_TOOL_NAMES, MAC_COMPUTER_TOOL_NAMES, MACHINE_ADMIN_TOOL_NAMES, MEMORY_LIFECYCLE_TOOL_NAMES, WINDOWS_COMPUTER_TOOL_NAMES, WORKSPACE_EXEC_TOOL_NAMES, WORKSPACE_PATCH_TOOL_NAMES, WORKSPACE_READ_TOOL_NAMES, WORKSPACE_WRITE_TOOL_NAMES } from './actionSurface.js';

export function workspacePolicy(workspace: Workspace, config?: AppConfig, platform: PlatformKind = platformKind()) {
  const configuredSets = resolvedApiSets(workspace);
  const effectiveSets = effectiveApiSets(workspace, platform);
  return ok('workspace policy', {
    id: workspace.id,
    name: workspace.name,
    root_label: 'configured workspace root',
    filesystem_scope: filesystemScope(workspace),
    host_platform: platform,
    configured_api_sets: configuredSets,
    api_sets: effectiveSets,
    api_set_incompatibilities: apiSetIncompatibilities(configuredSets, platform),
    api_set_notes: apiSetNotes(),
    policy_model: policyModel(),
    command_runtime: commandRuntimeInfo(undefined, config?.command_runtime),
    censoring: censoringPolicy(workspace, config),
    git: gitPolicy(workspace),
    github: githubPolicy(workspace),
    allowed_tools: allowedTools(workspace, platform),
    windows_computer_rights: workspace.windows_computer,
    memory_interface: memoryInterface(workspace),
    // Provider-side confirmation prompts are harmful for OpenClaw-like chat-thread agents.
    // Routine scoped workspace/browser/computer tools are intentionally not listed as blocked
    // or requiring per-call approval. Calvin policy: do not add stop_boundaries or blocked_tools
    // without Calvin's explicit approval.
    requires_approval: []
  });
}


function apiSetNotes() {
  return {
    workspace: 'OpenClaw-like workspace agent primitives: scoped files, tmp cleanup/delete, artifacts, context, skills, bounded run_command/processes, git/context helpers, and async run recovery.',
    browser: 'Direct full scoped CDP access to preassigned browser profiles/ports. browser_visible_state/click/upload helpers are convenience tools only, not an observer/read-only fallback.',
    computer: 'Local macOS GUI/computer-use via Cua Driver; ignored on non-macOS hosts.',
    computer_windows: 'Windows desktop computer-use via native APIs; ignored on non-Windows hosts. The macro grants full Windows rights subject to configured per-right controls.',
    machine_admin: 'Host/lane administration and configured operations. Explicit absolute host paths remain governed by filesystem.machine_admin_host_scope.',
    estate_admin: 'Cross-agent/cross-host estate reports/diagnostics and approved estate runbook operations.'
  };
}

function policyModel() {
  return {
    principle: 'Webchat agents should not be weaker than OpenClaw agents when a capability set is enabled; safety wraps powerful primitives instead of replacing them with toy actions.',
    workspace_exec: 'Bounded run_command/start_process/read_process/write_process/stop_process are normal workspace-agent primitives when workspace or allow_tests is enabled.',
    workspace_delete: 'delete_file/delete_path are normal scoped workspace editing tools, suitable for tmp cleanup and routine file management.',
    machine_admin: 'run_configured_command and service/tunnel/host administration are machine_admin. Existing file tools remain one vocabulary: workspace-only lanes stay root-scoped; machine_admin host-scope lanes may use explicit absolute host paths inside host_root. No hidden path/secret/glob deny layer exists; adding one requires Calvin approval.',
    provider_prompts: 'Provider-side confirmation prompts are intentionally minimized for routine scoped workspace/browser/computer work. OTA policy must not add generic stop-boundary lists; if the real UI blocks progress, report the concrete blocker.'
  };
}

function memoryInterface(workspace: Workspace) {
  return {
    tools: [...MEMORY_LIFECYCLE_TOOL_NAMES],
    backend_configured: workspace.ota_memory?.enabled === true
  };
}


function censoringPolicy(workspace: Workspace, config?: AppConfig) {
  const defaults = { secret_value_redaction: false, result_sanitization: false, secret_content_heuristics: false, environment_filtering: false };
  return {
    umbrella_config_key: 'security.conservative_censoring',
    conservative_censoring: config ? conservativeCensoringEnabled(config) : false,
    defaults,
    effective: config ? {
      secret_value_redaction: secretValueRedactionEnabled(config),
      result_sanitization: resultSanitizationEnabled(config),
      secret_content_heuristics: secretContentHeuristicsEnabled(config),
      environment_filtering: environmentFilteringEnabled(config)
    } : defaults,
    child_environment: config ? workspaceChildEnvironmentMode(config, workspace) : 'minimal',
    child_environment_policy: 'machine_admin/estate_admin use full host environment by default; ordinary workspaces use PATH, HOME, LANG, LC_ALL, SHELL only; conservative/environment_filtering forces minimal.',
    note: 'These are OTA application controls. Provider/platform safety and connector-host enforcement are separate.'
  };
}

function gitPolicy(workspace: Workspace) {
  return {
    enabled: allowedTools(workspace).includes('git'),
    operation: 'git',
    auth_lane: workspace.git?.github_token_file ? 'configured_token_git_config_env' : 'default_workspace_token_git_config_env',
    identity_lane: workspace.git?.user_name && workspace.git?.user_email ? 'configured_workspace_identity' : 'repository_or_global_identity',
    accepted_parameter_model: 'unrestricted_cmd_array_forwarded_to_git_adapter'
  };
}

function githubPolicy(workspace: Workspace) {
  const allowed = allowedTools(workspace).includes('github');
  return {
    enabled: allowed,
    preferred_surface: 'ota_github_operation',
    operation: 'github',
    auth_lane: workspace.git?.github_token_file ? 'configured_token_file' : 'default_workspace_token_file',
    permission_model: 'github_pat_scope',
    adapter: workspace.git?.github_cli_wrapper ? 'gh_cli_wrapper' : 'gh_cli',
    raw_cli_via_run_command: 'discouraged',
    accepted_parameter_model: 'unrestricted_cmd_array_forwarded_to_gh_adapter'
  };
}


function filesystemScope(workspace: Workspace) {
  const sets = resolvedApiSets(workspace);
  const hostScope = Boolean(sets.machine_admin && workspace.filesystem?.machine_admin_host_scope);
  return {
    default_scope: 'workspace',
    absolute_path_scope: hostScope ? 'host' : 'workspace',
    machine_admin_host_scope: hostScope,
    host_root: hostScope ? (workspace.filesystem?.host_root ?? '/') : undefined,
    note: hostScope
      ? 'Existing file tools may access explicit absolute host paths inside host_root. Relative paths remain resolved from the configured workspace root.'
      : 'Existing file tools are scoped to the configured workspace root; absolute paths outside that root are denied.'
  };
}

export function resolvedApiSets(workspace: Workspace) {
  const configured = workspace.api_sets ?? {};
  const hasConfiguredSets = Object.keys(configured).length > 0;
  return {
    workspace: configured.workspace ?? (workspace.allow_read || workspace.allow_write || workspace.allow_patch || workspace.allow_tests),
    browser: configured.browser ?? workspace.allow_mouse_keyboard,
    // Backward-compatible inference: old configs used allow_screen/allow_mouse_keyboard for both
    // browser and computer capability. New api_sets configs can distinguish browser from Cua/computer use.
    computer: configured.computer ?? (!hasConfiguredSets && (workspace.allow_screen || workspace.allow_mouse_keyboard)),
    computer_windows: configured.computer_windows ?? workspace.windows_computer?.enabled ?? false,
    machine_admin: configured.machine_admin ?? false,
    estate_admin: configured.estate_admin ?? false
  };
}

export function effectiveApiSets(workspace: Workspace, platform: PlatformKind = platformKind()) {
  const sets = resolvedApiSets(workspace);
  return {
    ...sets,
    computer: Boolean(sets.computer && platform === 'macos'),
    computer_windows: Boolean(sets.computer_windows && platform === 'windows')
  };
}

export function allowedTools(workspace: Workspace, platform: PlatformKind = platformKind()): string[] {
  const sets = effectiveApiSets(workspace, platform);
  const base: string[] = [...BASE_TOOL_NAMES];

  // Lifecycle-v1 memory actions are a stable provider interface for every agent.
  // Backend readiness is separate: unconfigured workspaces fail explicitly at call time.
  base.push(...MEMORY_LIFECYCLE_TOOL_NAMES);
  if (sets.estate_admin) base.push(...ESTATE_ADMIN_TOOL_NAMES);
  if (sets.workspace || workspace.allow_read) base.push(...WORKSPACE_READ_TOOL_NAMES);
  if (sets.workspace || workspace.allow_write) base.push(...WORKSPACE_WRITE_TOOL_NAMES);
  if (sets.workspace || workspace.allow_patch) base.push(...WORKSPACE_PATCH_TOOL_NAMES);
  if (sets.workspace || workspace.allow_tests) base.push(...WORKSPACE_EXEC_TOOL_NAMES);
  if (sets.browser) base.push(...BROWSER_TOOL_NAMES);
  if (sets.computer) base.push(...MAC_COMPUTER_TOOL_NAMES);
  if (sets.computer_windows) base.push(...windowsComputerTools(workspace));
  if (sets.machine_admin) base.push(...MACHINE_ADMIN_TOOL_NAMES);

  return [...new Set(base)];
}

function apiSetIncompatibilities(sets: ReturnType<typeof resolvedApiSets>, platform: PlatformKind): string[] {
  const out: string[] = [];
  if (sets.computer && platform !== 'macos') out.push(`api_sets.computer requires macOS host; current host is ${platform}`);
  if (sets.computer_windows && platform !== 'windows') out.push(`api_sets.computer_windows requires Windows host; current host is ${platform}`);
  return out;
}

function windowsComputerTools(workspace: Workspace) {
  const config = workspace.windows_computer;
  const tools: string[] = [WINDOWS_COMPUTER_TOOL_NAMES[0], WINDOWS_COMPUTER_TOOL_NAMES[1]];
  if (config?.allow_screenshot) tools.push('windows_screenshot');
  if (config?.allow_screenshot && config?.allow_window_management) tools.push('windows_window_screenshot', 'windows_window_screenshot_sequence');
  if (config?.allow_uia_tree) tools.push('windows_uia_tree', 'windows_uia_read');
  if (config?.allow_uia_tree && config?.allow_keyboard) tools.push('windows_uia_set_value');
  if (config?.allow_window_management) tools.push('windows_list_windows', 'windows_focus_window', 'windows_place_window');
  if (config?.allow_app_launch) tools.push('windows_launch_app');
  if (config?.allow_mouse) tools.push('windows_mouse_move', 'windows_click', 'windows_double_click', 'windows_drag', 'windows_scroll');
  if (config?.allow_mouse && config?.allow_window_management) tools.push('windows_window_mouse_move', 'windows_window_click', 'windows_window_double_click', 'windows_window_drag', 'windows_window_scroll');
  if (config?.allow_keyboard) tools.push('windows_type_text', 'windows_key', 'windows_hotkey');
  if (config?.allow_clipboard) tools.push('windows_clipboard_get', 'windows_clipboard_set');
  if (config?.allow_mouse || config?.allow_keyboard) tools.push('windows_batch');
  return tools;
}
