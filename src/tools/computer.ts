import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ok } from '../core/result.js';
import { platformInfo } from '../core/platform.js';
import type { Workspace } from '../core/workspaces.js';

const execFileAsync = promisify(execFile);
const CUA_DRIVER = process.env.CUA_DRIVER_BIN || 'cua-driver';
const MAX_SCREENSHOT_BASE64 = 40000;
const MAX_BATCH_STEPS = 25;
const READ_ONLY_CUA_TOOLS = new Set([
  'check_permissions',
  'list_windows',
  'get_screen_size',
  'get_window_state',
  'get_accessibility_tree',
  'get_agent_cursor_state',
  'screenshot'
]);
const MUTATING_CUA_TOOLS = new Set([
  'click',
  'double_click',
  'drag',
  'hotkey',
  'press_key',
  'set_value',
  'type_text',
  'type_text_chars',
  'zoom'
]);
const ALLOWED_CUA_TOOLS = new Set([...READ_ONLY_CUA_TOOLS, ...MUTATING_CUA_TOOLS]);

export type CuaDriverBatchStep =
  | { method: string; params?: Record<string, unknown> }
  | { delay_ms: number };

export async function cuaDriverStatus(workspace: Workspace) {
  const adapter = await cuaAdapterStatus(workspace);
  return ok('cua driver status', {
    workspace_id: workspace.id,
    platform: platformInfo(),
    driver: 'cua-driver',
    executable: CUA_DRIVER,
    capabilities: {
      screen: workspace.allow_screen,
      mouse_keyboard: workspace.allow_mouse_keyboard,
      batch_delay_steps: true
    },
    allowed_methods: {
      read_only: [...READ_ONLY_CUA_TOOLS],
      mutating: [...MUTATING_CUA_TOOLS]
    },
    adapter
  });
}

export async function cuaDriverCall(workspace: Workspace, method: string, params: Record<string, unknown> = {}) {
  const readOnly = authorizeCuaMethod(workspace, method);
  const result = await cuaCall(method, sanitizeCuaArgs(params));
  return ok('cua driver call', { method, read_only: readOnly, result: boundCuaResult(method, result) });
}

export async function cuaDriverBatch(workspace: Workspace, calls: CuaDriverBatchStep[]) {
  if (!Array.isArray(calls) || calls.length === 0) throw new Error('cua driver batch requires at least one step');
  if (calls.length > MAX_BATCH_STEPS) throw new Error(`cua driver batch supports at most ${MAX_BATCH_STEPS} steps`);

  const results: Record<string, unknown>[] = [];
  for (const [index, step] of calls.entries()) {
    const started = Date.now();
    if ('delay_ms' in step) {
      const delayMs = clampDelay(step.delay_ms);
      await delay(delayMs);
      results.push({ index, kind: 'delay', delay_ms: delayMs, elapsed_ms: Date.now() - started });
      continue;
    }

    const method = step.method;
    const params = sanitizeCuaArgs(step.params ?? {});
    let readOnly: boolean | undefined;
    try {
      readOnly = authorizeCuaMethod(workspace, method);
      const result = await cuaCall(method, params);
      results.push({ index, kind: 'cua_driver', method, read_only: readOnly, result: boundCuaResult(method, result), elapsed_ms: Date.now() - started });
    } catch (error) {
      results.push({ index, kind: 'cua_driver', method, read_only: readOnly, error: error instanceof Error ? error.message : String(error), elapsed_ms: Date.now() - started });
      break;
    }
  }

  const failed = results.find((row) => 'error' in row);
  return ok(failed ? 'cua driver batch stopped on error' : 'cua driver batch completed', { results, stopped_on_error: failed ?? null });
}

function authorizeCuaMethod(workspace: Workspace, method: string) {
  if (!ALLOWED_CUA_TOOLS.has(method)) throw new Error(`cua driver method is not allowed: ${method}`);
  const readOnly = READ_ONLY_CUA_TOOLS.has(method);
  if (readOnly) {
    if (!workspace.allow_screen) throw new Error('screen observation is not enabled for this workspace');
  } else {
    ensureMouseKeyboard(workspace);
  }
  return readOnly;
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

async function safeCuaCall(method: string, params: Record<string, unknown>) {
  try { return { ok: true, data: await cuaCall(method, params) }; }
  catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
}

async function cuaCall(method: string, params: Record<string, unknown>) {
  const { stdout, stderr } = await execFileAsync(CUA_DRIVER, ['call', method, JSON.stringify(params)], {
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

function sanitizeCuaArgs(args: Record<string, unknown>) {
  return JSON.parse(JSON.stringify(args ?? {})) as Record<string, unknown>;
}

function boundCuaResult(method: string, result: unknown) {
  if (method === 'list_windows') return boundWindows(result);
  if (method === 'screenshot') return boundedScreenshot(result);
  return result;
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
