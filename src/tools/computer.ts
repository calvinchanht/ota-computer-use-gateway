import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
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
  return ok('cua driver call', { method, read_only: readOnly, result: await boundCuaResult(workspace, method, result) });
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
      results.push({ index, kind: 'cua_driver', method, read_only: readOnly, result: await boundCuaResult(workspace, method, result), elapsed_ms: Date.now() - started });
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

async function boundCuaResult(workspace: Workspace, method: string, result: unknown) {
  if (method === 'list_windows') return boundWindows(result);
  if (method === 'screenshot') return boundedScreenshot(workspace, result);
  if (method === 'get_window_state') return boundWindowState(workspace, result);
  if (method === 'get_agent_cursor_state') return boundCursorState(result);
  return boundLargeStrings(result);
}

function boundWindows(data: unknown) {
  const payload = data as { windows?: unknown[]; current_space_id?: unknown };
  const windows = Array.isArray(payload.windows) ? payload.windows.slice(0, 80) : [];
  return { current_space_id: payload.current_space_id ?? null, windows, truncated: Array.isArray(payload.windows) && payload.windows.length > windows.length, count: Array.isArray(payload.windows) ? payload.windows.length : windows.length };
}

async function boundCursorState(data: unknown) {
  const bounded = await boundLargeStrings(data) as Record<string, unknown>;
  const cursors = Array.isArray(bounded.cursors) ? bounded.cursors as Array<Record<string, unknown>> : [];
  const hasPosition = cursors.some((cursor) => cursor.position && typeof cursor.position === 'object');
  if (!hasPosition) {
    const fallback = await getMacCursorPosition();
    if (fallback) bounded.fallback_position = fallback;
  }
  return bounded;
}

async function getMacCursorPosition() {
  if (process.platform !== 'darwin') return null;
  try {
    const script = 'ObjC.import("AppKit"); const p=$.NSEvent.mouseLocation; const h=$.NSScreen.screens.objectAtIndex(0).frame.size.height; JSON.stringify({x:Math.round(p.x), y:Math.round(h-p.y), mac_y_up:Math.round(p.y), coordinate_system:"screen_top_left"})';
    const { stdout } = await execFileAsync('/usr/bin/osascript', ['-l', 'JavaScript', '-e', script], { timeout: 5000, maxBuffer: 1024 * 1024 });
    return JSON.parse(stdout.trim()) as Record<string, unknown>;
  } catch { return null; }
}

async function boundWindowState(workspace: Workspace, data: unknown) {
  return boundLargeStrings(data, async (key, value) => {
    const lower = key.toLowerCase();
    if (lower.includes('screenshot') && lower.includes('base64')) {
      const artifact = await writeBase64ScreenshotArtifact(workspace, value);
      return { replacement: null, extra: { [`${key}_artifact`]: artifact, [`${key}_omitted`]: `base64 screenshot payload omitted (${value.length} chars > ${MAX_SCREENSHOT_BASE64})` } };
    }
    return null;
  });
}

async function boundedScreenshot(workspace: Workspace, data: unknown) {
  const payload = data as Record<string, unknown>;
  const copy: Record<string, unknown> = { ...payload };
  for (const [key, value] of Object.entries(copy)) {
    if (typeof value === 'string' && value.length > MAX_SCREENSHOT_BASE64) {
      copy[key] = null;
      copy[`${key}_omitted`] = `base64 payload omitted (${value.length} chars > ${MAX_SCREENSHOT_BASE64})`;
    }
  }

  if (!hasScreenshotPayload(copy)) {
    const artifact = await captureScreenshotArtifact(workspace);
    if (artifact) {
      copy.artifact = artifact;
      copy.note = 'cua-driver returned screenshot metadata only; saved a macOS screencapture artifact instead';
    }
  }
  return copy;
}

function hasScreenshotPayload(value: Record<string, unknown>) {
  return ['data', 'base64', 'image', 'image_base64', 'bytes', 'path', 'file', 'artifact'].some((key) => typeof value[key] === 'string' && String(value[key]).length > 0);
}

async function captureScreenshotArtifact(workspace: Workspace) {
  if (process.platform !== 'darwin') return null;
  const absolutePath = screenshotArtifactPath(workspace);
  await ensureScreenshotArtifactDir(absolutePath);
  await execFileAsync('/usr/sbin/screencapture', ['-x', absolutePath], { timeout: 15000, maxBuffer: 1024 * 1024 });
  return screenshotArtifact(workspace, absolutePath);
}

async function writeBase64ScreenshotArtifact(workspace: Workspace, base64: string) {
  const absolutePath = screenshotArtifactPath(workspace);
  await ensureScreenshotArtifactDir(absolutePath);
  await writeFile(absolutePath, Buffer.from(base64, 'base64'));
  return screenshotArtifact(workspace, absolutePath);
}

function screenshotArtifactPath(workspace: Workspace) {
  const dir = path.join(workspace.realAgentDir, 'artifacts', 'screenshots');
  const filename = `cua-screenshot-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
  return path.join(dir, filename);
}

async function ensureScreenshotArtifactDir(absolutePath: string) {
  await mkdir(path.dirname(absolutePath), { recursive: true });
}

function screenshotArtifact(workspace: Workspace, absolutePath: string) {
  return {
    kind: 'image',
    format: 'png',
    path: workspaceRelativePath(workspace, absolutePath),
    agent_artifact_path: agentRelativePath(workspace, absolutePath)
  };
}

async function boundLargeStrings(value: unknown, onLargeString?: (key: string, value: string) => Promise<{ replacement: unknown; extra?: Record<string, unknown> } | null>): Promise<unknown> {
  if (Array.isArray(value)) return Promise.all(value.map((item) => boundLargeStrings(item, onLargeString)));
  if (!value || typeof value !== 'object') return value;

  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (typeof item === 'string' && item.length > MAX_SCREENSHOT_BASE64) {
      const custom = onLargeString ? await onLargeString(key, item) : null;
      if (custom) {
        out[key] = custom.replacement;
        if (custom.extra) Object.assign(out, custom.extra);
      } else {
        out[key] = null;
        out[`${key}_omitted`] = `string payload omitted (${item.length} chars > ${MAX_SCREENSHOT_BASE64})`;
      }
    } else {
      out[key] = await boundLargeStrings(item, onLargeString);
    }
  }
  return out;
}

function workspaceRelativePath(workspace: Workspace, absolutePath: string) {
  const relative = path.relative(workspace.realRoot, absolutePath);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? relative : agentRelativePath(workspace, absolutePath);
}

function agentRelativePath(workspace: Workspace, absolutePath: string) {
  const relative = path.relative(workspace.realAgentDir, absolutePath);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? `.agent/${relative.replaceAll(path.sep, '/')}` : 'artifact';
}

function clampDelay(value: number) {
  return Math.min(Math.max(Math.trunc(value), 0), 5000);
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
