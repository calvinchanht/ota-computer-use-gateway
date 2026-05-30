import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ok } from '../core/result.js';
import { platformInfo } from '../core/platform.js';
import type { Workspace } from '../core/workspaces.js';

const execFileAsync = promisify(execFile);
const CUA_DRIVER = process.env.CUA_DRIVER_BIN || 'cua-driver';
const MAX_SCREENSHOT_BASE64 = 40000;

export type ObserveAfter = {
  delay_ms?: number;
  screenshot?: boolean;
  include_window_tree?: boolean;
};

export async function computerStatus(workspace: Workspace) {
  const adapter = await cuaAdapterStatus(workspace);
  return ok('computer status', {
    workspace_id: workspace.id,
    platform: platformInfo(),
    capabilities: {
      screen: workspace.allow_screen,
      mouse_keyboard: workspace.allow_mouse_keyboard,
      observe_after: true
    },
    adapters: {
      screen: workspace.allow_screen ? adapter.screen : 'disabled',
      mouse_keyboard: workspace.allow_mouse_keyboard ? adapter.mouse_keyboard : 'disabled',
      cua_driver: adapter
    }
  });
}

export async function observeScreen(workspace: Workspace) {
  if (!workspace.allow_screen) throw new Error('screen observation is not enabled for this workspace');
  if (process.platform !== 'darwin') return pendingObservation(workspace, 'cua-driver screen adapter is only active on macOS hosts');
  const status = await cuaAdapterStatus(workspace);
  if (status.status !== 'ready') return pendingObservation(workspace, status.error || 'cua-driver is not ready');

  const [screenSize, windows, screenshot] = await Promise.all([
    safeCuaCall('get_screen_size', {}),
    safeCuaCall('list_windows', {}),
    safeCuaCall('screenshot', { format: 'jpeg', quality: 45 })
  ]);
  return ok('screen observation', {
    workspace_id: workspace.id,
    platform: platformInfo(),
    adapter_status: 'ready',
    permissions: status.permissions,
    screen_size: screenSize.ok ? screenSize.data : null,
    screen_size_error: screenSize.ok ? null : screenSize.error,
    window_tree: windows.ok ? boundWindows(windows.data) : null,
    window_tree_error: windows.ok ? null : windows.error,
    screenshot: screenshot.ok ? boundedScreenshot(screenshot.data) : null,
    screenshot_error: screenshot.ok ? null : screenshot.error
  });
}

export async function computerClick(workspace: Workspace, pid: number, x: number, y: number, windowId?: number, observe?: ObserveAfter) {
  ensureMouseKeyboard(workspace);
  const args: Record<string, unknown> = { pid, x, y };
  if (windowId !== undefined) args.window_id = windowId;
  const result = await cuaCall('click', args);
  return ok('computer click', { result, observe_after: await observeAfter(workspace, observe) });
}

export async function computerTypeText(workspace: Workspace, pid: number, text: string, windowId?: number, elementIndex?: number, delayMs?: number, observe?: ObserveAfter) {
  ensureMouseKeyboard(workspace);
  const args: Record<string, unknown> = { pid, text };
  if (windowId !== undefined) args.window_id = windowId;
  if (elementIndex !== undefined) args.element_index = elementIndex;
  if (delayMs !== undefined) args.delay_ms = clampDelay(delayMs);
  const result = await cuaCall('type_text_chars', args);
  return ok('computer typed text', { result, observe_after: await observeAfter(workspace, observe) });
}

export async function computerPressKey(workspace: Workspace, pid: number, key: string, windowId?: number, modifiers?: string[], elementIndex?: number, observe?: ObserveAfter) {
  ensureMouseKeyboard(workspace);
  const args: Record<string, unknown> = { pid, key };
  if (windowId !== undefined) args.window_id = windowId;
  if (modifiers?.length) args.modifiers = modifiers;
  if (elementIndex !== undefined) args.element_index = elementIndex;
  const result = await cuaCall('press_key', args);
  return ok('computer pressed key', { result, observe_after: await observeAfter(workspace, observe) });
}

export async function computerHotkey(workspace: Workspace, pid: number, keys: string[], windowId?: number, observe?: ObserveAfter) {
  ensureMouseKeyboard(workspace);
  const args: Record<string, unknown> = { pid, keys };
  if (windowId !== undefined) args.window_id = windowId;
  const result = await cuaCall('hotkey', args);
  return ok('computer hotkey', { result, observe_after: await observeAfter(workspace, observe) });
}

export async function observeAfter(workspace: Workspace, options?: ObserveAfter) {
  if (!options) return undefined;
  const delayMs = clampDelay(options.delay_ms ?? 0);
  if (delayMs > 0) await delay(delayMs);
  if (options.screenshot || options.include_window_tree) return (await observeScreen(workspace)).data;
  return { delay_ms: delayMs };
}

function ensureMouseKeyboard(workspace: Workspace) {
  if (!workspace.allow_mouse_keyboard) throw new Error('mouse/keyboard control is not enabled for this workspace');
}

async function cuaAdapterStatus(workspace: Workspace) {
  if (process.platform !== 'darwin') return { status: 'pending', screen: 'pending', mouse_keyboard: 'pending', error: 'cua-driver adapter is only active on macOS hosts' };
  if (!workspace.allow_screen && !workspace.allow_mouse_keyboard) return { status: 'disabled', screen: 'disabled', mouse_keyboard: 'disabled' };
  const permissions = await safeCuaCall('check_permissions', {});
  if (!permissions.ok) return { status: 'pending', screen: 'pending', mouse_keyboard: 'pending', error: permissions.error };
  const perms = permissions.data as { accessibility?: boolean; screen_recording?: boolean };
  return {
    status: perms.accessibility && perms.screen_recording ? 'ready' : 'permission_missing',
    screen: perms.screen_recording ? 'cua-driver' : 'permission_missing',
    mouse_keyboard: perms.accessibility ? 'cua-driver' : 'permission_missing',
    permissions: perms
  };
}

function pendingObservation(workspace: Workspace, note: string) {
  return ok('screen observation adapter pending', {
    workspace_id: workspace.id,
    platform: platformInfo(),
    screenshot: null,
    window_tree: null,
    adapter_status: 'pending',
    note
  });
}

async function safeCuaCall(tool: string, args: Record<string, unknown>) {
  try { return { ok: true, data: await cuaCall(tool, args) }; }
  catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
}

async function cuaCall(tool: string, args: Record<string, unknown>) {
  const { stdout, stderr } = await execFileAsync(CUA_DRIVER, ['call', tool, JSON.stringify(args)], {
    timeout: 15000,
    maxBuffer: 5 * 1024 * 1024,
    env: {
      ...process.env,
      DEVELOPER_DIR: process.env.DEVELOPER_DIR || '/Library/Developer/CommandLineTools'
    }
  });
  const output = stdout.trim();
  if (!output && stderr.trim()) return stderr.trim();
  try { return JSON.parse(output); }
  catch { return output; }
}

function boundWindows(data: unknown) {
  const payload = data as { windows?: unknown[]; current_space_id?: unknown };
  const windows = Array.isArray(payload.windows) ? payload.windows.slice(0, 80) : [];
  return { current_space_id: payload.current_space_id ?? null, windows, truncated: Array.isArray(payload.windows) && payload.windows.length > windows.length, count: Array.isArray(payload.windows) ? payload.windows.length : windows.length };
}

function boundedScreenshot(data: unknown) {
  const payload = data as Record<string, unknown>;
  const copy: Record<string, unknown> = { ...payload };
  for (const [key, value] of Object.entries(copy)) {
    if (typeof value === 'string' && value.length > MAX_SCREENSHOT_BASE64) {
      copy[key] = null;
      copy[`${key}_omitted`] = `base64 payload omitted (${value.length} chars > ${MAX_SCREENSHOT_BASE64})`;
    }
  }
  return copy;
}

function clampDelay(value: number) {
  return Math.min(Math.max(Math.trunc(value), 0), 5000);
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
