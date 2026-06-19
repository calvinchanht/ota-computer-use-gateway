import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import path from 'node:path';
import { promisify } from 'node:util';
import { ok } from '../core/result.js';
import { signedArtifactUrl } from '../server/artifactSignatures.js';
import { platformInfo } from '../core/platform.js';
import type { Workspace } from '../core/workspaces.js';

const execFileAsync = promisify(execFile);
const CUA_DRIVER = process.env.CUA_DRIVER_BIN || 'cua-driver';
const MAX_SCREENSHOT_BASE64 = 40000;
const MAX_BATCH_STEPS = 25;
const DEFAULT_SCREENSHOT_CLEANUP_OLDER_THAN_SECONDS = 86400;
const DEFAULT_SCREENSHOT_KEEP_LATEST = 100;
const SCREENSHOT_ARTIFACT_PREFIX = 'cua-screenshot-';
const SCREENSHOT_PREVIEW_SUFFIX = '-preview.webp';
const SCREENSHOT_FULL_SUFFIX = '-full.png';
const SCREENSHOT_WEBP_QUALITY = 85;
const WINDOW_STATE_ARTIFACT_PREFIX = 'cua-window-state-';
const WINDOW_STATE_ARTIFACT_SUFFIX = '.md';
const READ_ONLY_CUA_TOOLS = new Set([
  'check_permissions',
  'list_windows',
  'get_screen_size',
  'get_window_state',
  'get_accessibility_tree',
  'get_agent_cursor_state',
  'get_cursor_position',
  'screenshot'
]);
const MUTATING_CUA_TOOLS = new Set([
  'click',
  'double_click',
  'right_click',
  'drag',
  'scroll',
  'move_cursor',
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
  const sanitizedParams = sanitizeCuaArgs(params);
  if (requiresNativePid(method) && !hasPid(sanitizedParams)) throw new Error(`${method} is a native Cua window/process mouse command and requires params.pid. Use computer_screen_* for global screen coordinates, or call list_windows/get_window_state and then use computer_window_* with the target pid/window_id.`);
  const result = await cuaCall(method, sanitizedParams);
  return ok('cua driver call', { method, read_only: readOnly, result: await boundCuaResult(workspace, method, result, sanitizedParams) });
}

export async function computerScreenClick(workspace: Workspace, x: number, y: number, button = 'left', click_count = 1) {
  ensureMouseKeyboard(workspace);
  const target = await inferRequiredScreenTarget('computer_screen_click', x, y);
  const point = windowPointParams(target, x, y) as { x: number; y: number };
  const { method, params } = clickCommand(clickParams(point.x, point.y, { pid: target.pid, window_id: target.window_id }), button, click_count);
  const result = await cuaCall(method, params);
  return ok('computer screen click', await screenMouseResult(method, target, params, result, workspace));
}

export async function computerWindowClick(workspace: Workspace, pid: number, x: number, y: number, window_id?: number, button = 'left', click_count = 1) {
  ensureMouseKeyboard(workspace);
  ensurePid('computer_window_click', pid);
  const { method, params } = clickCommand(clickParams(x, y, { pid, window_id }), button, click_count);
  const result = await cuaCall(method, params);
  return ok('computer window click', { method, coordinate_space: 'window_or_process', params, result: await boundCuaResult(workspace, method, result, params) });
}

export async function computerScreenMouseMove(workspace: Workspace, x: number, y: number) {
  ensureMouseKeyboard(workspace);
  const params = { x, y };
  const method = 'move_cursor';
  const result = await cuaCall(method, params);
  return ok('computer screen mouse move', { method, coordinate_space: 'screen', cursor_kind: 'agent_overlay', params, result: await boundCuaResult(workspace, method, result, params) });
}

export async function computerWindowMouseMove(workspace: Workspace, pid: number, x: number, y: number, window_id?: number) {
  ensureMouseKeyboard(workspace);
  ensurePid('computer_window_mouse_move', pid);
  const target = await findRequiredWindowTarget('computer_window_mouse_move', pid, window_id);
  const params = screenPointFromWindowTarget(target, x, y);
  const method = 'move_cursor';
  const result = await cuaCall(method, params);
  return ok('computer window mouse move', { method, coordinate_space: 'window_or_process', cursor_kind: 'agent_overlay', target, params, result: await boundCuaResult(workspace, method, result, params) });
}

export async function computerScreenDrag(workspace: Workspace, from_x: number, from_y: number, to_x: number, to_y: number, button = 'left', duration_ms?: number, steps?: number) {
  ensureMouseKeyboard(workspace);
  const target = await inferRequiredScreenTarget('computer_screen_drag', from_x, from_y);
  const from = windowPointParams(target, from_x, from_y, 'from') as { from_x: number; from_y: number };
  const to = windowPointParams(target, to_x, to_y, 'to') as { to_x: number; to_y: number };
  const params = dragParams(from, to, { pid: target.pid, window_id: target.window_id }, button, duration_ms, steps);
  const method = 'drag';
  const result = await cuaCall(method, params);
  return ok('computer screen drag', await screenMouseResult(method, target, params, result, workspace));
}

export async function computerWindowDrag(workspace: Workspace, pid: number, from_x: number, from_y: number, to_x: number, to_y: number, window_id?: number, button = 'left', duration_ms?: number, steps?: number) {
  ensureMouseKeyboard(workspace);
  ensurePid('computer_window_drag', pid);
  const params = dragParams({ from_x, from_y }, { to_x, to_y }, { pid, window_id }, button, duration_ms, steps);
  const method = 'drag';
  const result = await cuaCall(method, params);
  return ok('computer window drag', { method, coordinate_space: 'window_or_process', params, result: await boundCuaResult(workspace, method, result, params) });
}

export async function computerScreenScroll(workspace: Workspace, x: number, y: number, direction: string, amount = 3, by = 'line') {
  ensureMouseKeyboard(workspace);
  const target = await inferRequiredScreenTarget('computer_screen_scroll', x, y);
  const params = scrollParams(target.pid, direction, amount, by, target.window_id);
  const method = 'scroll';
  const result = await cuaCall(method, params);
  return ok('computer screen scroll', await screenMouseResult(method, target, params, result, workspace));
}

export async function computerWindowScroll(workspace: Workspace, pid: number, direction: string, window_id?: number, amount = 3, by = 'line') {
  ensureMouseKeyboard(workspace);
  ensurePid('computer_window_scroll', pid);
  const params = scrollParams(pid, direction, amount, by, window_id);
  const method = 'scroll';
  const result = await cuaCall(method, params);
  return ok('computer window scroll', { method, coordinate_space: 'window_or_process', params, result: await boundCuaResult(workspace, method, result, params) });
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
      results.push({ index, kind: 'cua_driver', method, read_only: readOnly, result: await boundCuaResult(workspace, method, result, params), elapsed_ms: Date.now() - started });
    } catch (error) {
      results.push({ index, kind: 'cua_driver', method, read_only: readOnly, error: error instanceof Error ? error.message : String(error), elapsed_ms: Date.now() - started });
      break;
    }
  }

  const failed = results.find((row) => 'error' in row);
  return ok(failed ? 'cua driver batch stopped on error' : 'cua driver batch completed', { results, stopped_on_error: failed ?? null });
}


type InferredWindowTarget = { pid: number; window_id?: number; title?: string; app?: string; reason: string; bounds?: { x: number; y: number; width: number; height: number } };

function hasPid(params: Record<string, unknown>): boolean {
  return typeof params.pid === 'number' || (typeof params.pid === 'string' && params.pid.trim().length > 0);
}

function requiresNativePid(method: string): boolean {
  return ['click', 'double_click', 'right_click', 'drag', 'scroll'].includes(method);
}

async function inferRequiredScreenTarget(tool: string, x: number, y: number): Promise<InferredWindowTarget> {
  const windows = await safeCuaCall('list_windows', {});
  const target = windows.ok ? inferTargetWindow(windows.data, x, y) : null;
  if (!target) throw new Error(`${tool} could not infer a target pid from list_windows. Call cua_driver_call list_windows, verify the target window is visible/frontmost, then use the matching computer_window_* tool with that pid/window_id.`);
  return target;
}

async function findRequiredWindowTarget(tool: string, pid: number, windowId?: number): Promise<InferredWindowTarget> {
  const windows = await safeCuaCall('list_windows', {});
  const target = windows.ok ? findWindowTarget(windows.data, pid, windowId) : null;
  if (!target) throw new Error(`${tool} could not resolve window bounds for pid/window_id. Call cua_driver_call list_windows and verify the target window is visible, or use computer_screen_mouse_move with global coordinates.`);
  return target;
}

function clickCommand(params: Record<string, unknown>, button: string, clickCount: number): { method: string; params: Record<string, unknown> } {
  const normalizedButton = (button || 'left').toLowerCase();
  if (normalizedButton === 'right') {
    if (clickCount > 1) throw new Error('right double-click is not supported by native Cua; use click_count=1 for right_click');
    return { method: 'right_click', params };
  }
  if (normalizedButton !== 'left') throw new Error(`unsupported Mac mouse button for click: ${button}`);
  return { method: clickCount > 1 ? 'double_click' : 'click', params };
}

function clickParams(x: number, y: number, target: { pid?: number; window_id?: number } = {}): Record<string, unknown> {
  const params: Record<string, unknown> = { x, y };
  if (target.pid !== undefined) params.pid = target.pid;
  if (target.window_id !== undefined) params.window_id = target.window_id;
  return params;
}

function dragParams(from: { from_x: number; from_y: number }, to: { to_x: number; to_y: number }, target: { pid?: number; window_id?: number }, button: string, durationMs?: number, steps?: number): Record<string, unknown> {
  const params: Record<string, unknown> = { ...from, ...to };
  if (target.pid !== undefined) params.pid = target.pid;
  if (target.window_id !== undefined) params.window_id = target.window_id;
  if (button) params.button = button;
  if (durationMs !== undefined) params.duration_ms = durationMs;
  if (steps !== undefined) params.steps = steps;
  return params;
}

function scrollParams(pid: number, direction: string, amount: number, by: string, windowId?: number): Record<string, unknown> {
  const params: Record<string, unknown> = { pid, direction, amount, by };
  if (windowId !== undefined) params.window_id = windowId;
  return params;
}

function windowPointParams(target: InferredWindowTarget, x: number, y: number, prefix?: 'from' | 'to'): Record<string, number> {
  const localX = target.bounds ? x - target.bounds.x : x;
  const localY = target.bounds ? y - target.bounds.y : y;
  if (prefix === 'from') return { from_x: localX, from_y: localY };
  if (prefix === 'to') return { to_x: localX, to_y: localY };
  return { x: localX, y: localY };
}

function screenPointFromWindowTarget(target: InferredWindowTarget, x: number, y: number): Record<string, number> {
  return { x: target.bounds ? target.bounds.x + x : x, y: target.bounds ? target.bounds.y + y : y };
}

async function screenMouseResult(method: string, target: InferredWindowTarget, params: Record<string, unknown>, result: unknown, workspace: Workspace) {
  return {
    method,
    coordinate_space: 'screen',
    inference: target.reason,
    inferred_target: target,
    params,
    result: await boundCuaResult(workspace, method, result, params)
  };
}

function ensurePid(tool: string, pid: number): void {
  if (!Number.isFinite(pid)) throw new Error(`${tool} requires pid from list_windows or get_window_state`);
}

function inferTargetWindow(data: unknown, x: number, y: number): InferredWindowTarget | null {
  const windows = visibleWindows(data);
  const containing = windows.find((window) => pointInWindow(window, x, y));
  const selected = containing ?? windows.find((window) => window.is_focused === true || window.focused === true || window.frontmost === true) ?? windows[0];
  return selected ? targetFromWindow(selected, containing ? 'window_under_coordinate' : 'frontmost_or_first_visible_window') : null;
}

function findWindowTarget(data: unknown, pid: number, windowId?: number): InferredWindowTarget | null {
  const windows = visibleWindows(data);
  const selected = windows.find((window) => numberValue(window.pid) === pid && (windowId === undefined || numberValue(window.window_id) === windowId || numberValue(window.id) === windowId)) ?? windows.find((window) => numberValue(window.pid) === pid);
  return selected ? targetFromWindow(selected, windowId === undefined ? 'pid_visible_window' : 'pid_window_id') : null;
}

function visibleWindows(data: unknown): Record<string, unknown>[] {
  const payload = data as { windows?: unknown[] };
  const windows = Array.isArray(payload.windows) ? payload.windows.filter(isRecord) : [];
  return windows.filter((window) => window.is_on_screen !== false && window.visible !== false);
}

function targetFromWindow(selected: Record<string, unknown>, reason: string): InferredWindowTarget | null {
  const pid = numberValue(selected.pid);
  if (pid === undefined) return null;
  return {
    pid,
    window_id: numberValue(selected.window_id) ?? numberValue(selected.id),
    title: typeof selected.title === 'string' ? selected.title : undefined,
    app: typeof selected.app === 'string' ? selected.app : typeof selected.app_name === 'string' ? selected.app_name : undefined,
    reason,
    bounds: windowBounds(selected)
  };
}

function pointInWindow(window: Record<string, unknown>, x: number, y: number): boolean {
  const bounds = windowBounds(window);
  if (!bounds) return false;
  return x >= bounds.x && x <= bounds.x + bounds.width && y >= bounds.y && y <= bounds.y + bounds.height;
}

function windowBounds(window: Record<string, unknown>): { x: number; y: number; width: number; height: number } | undefined {
  const bounds = isRecord(window.bounds) ? window.bounds : window;
  const x = numberValue(bounds.x) ?? numberValue(bounds.left);
  const y = numberValue(bounds.y) ?? numberValue(bounds.top);
  const width = numberValue(bounds.width);
  const height = numberValue(bounds.height);
  if (x === undefined || y === undefined || width === undefined || height === undefined) return undefined;
  return { x, y, width, height };
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return undefined;
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

async function boundCuaResult(workspace: Workspace, method: string, result: unknown, params: Record<string, unknown> = {}) {
  if (method === 'list_windows') return boundWindows(result);
  if (method === 'screenshot') return boundedScreenshot(workspace, result, params);
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
    if (fallback) {
      bounded.position = fallback;
      bounded.position_source = 'macos_fallback';
      bounded.fallback_position = fallback;
      for (const cursor of cursors) if (!cursor.position) cursor.fallback_position = fallback;
    }
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
    if (lower === 'tree_markdown' || lower.endsWith('_tree_markdown')) {
      const artifact = await writeWindowStateTextArtifact(workspace, value);
      return { replacement: value.slice(0, MAX_SCREENSHOT_BASE64), extra: { [`${key}_artifact`]: artifact, [`${key}_truncated`]: true, [`${key}_omitted`]: `full accessibility tree saved as artifact (${value.length} chars > ${MAX_SCREENSHOT_BASE64})` } };
    }
    return null;
  });
}

async function boundedScreenshot(workspace: Workspace, data: unknown, params: Record<string, unknown> = {}) {
  const payload = data as Record<string, unknown>;
  const copy: Record<string, unknown> = { ...payload };
  for (const [key, value] of Object.entries(copy)) {
    if (typeof value === 'string' && value.length > MAX_SCREENSHOT_BASE64) {
      copy[key] = null;
      copy[`${key}_omitted`] = `base64 payload omitted (${value.length} chars > ${MAX_SCREENSHOT_BASE64})`;
    }
  }

  const cleanup = await cleanupScreenshotArtifacts(workspace, params);
  if (cleanup) copy.cleanup = cleanup;

  if (!hasScreenshotPayload(copy)) {
    const artifact = await captureScreenshotArtifact(workspace);
    if (artifact) {
      copy.artifact = artifact;
      copy.preview = artifact.preview;
      copy.full = artifact.full;
      copy.note = 'cua-driver returned screenshot metadata only; saved a macOS screencapture PNG plus a half-size WebP preview artifact';
    }
  }
  copy.retention_note = 'Screenshot artifacts are transient working files: default preview is half-size WebP quality 85, full source is PNG, and transient screenshots should be zipped/pruned by retention jobs unless copied to durable task/project artifacts.';
  copy.visual_followup = await screenshotVisualFollowup(copy, params);
  return copy;
}


export async function screenshotVisualFollowup(screenshot: Record<string, unknown>, params: Record<string, unknown> = {}) {
  const readableUrl = screenshotReadableUrl(screenshot);
  if (!readableUrl) return { state: 'not_available', sent_to_provider: false, provider_visible: false, reason: 'readable_url_missing', instruction: 'Screenshot was captured, but no readable URL was available to send as a visible follow-up.' };
  const input = visualFollowupInput(params, readableUrl);
  if (!input.job_id) {
    return {
      state: 'not_requested',
      sent_to_provider: false,
      provider_visible: false,
      reason: 'threaddex_job_id_required',
      instruction: 'To make this screenshot visible to the model, call screenshot with params.visual_followup.job_id set to the active Threaddex job id, then poll visual_followup.status_url until sent_to_provider is true.'
    };
  }
  try {
    const response = await fetch(`${input.base_url}/v1/job/${encodeURIComponent(input.job_id)}/visual-followup`, {
      method: 'POST',
      headers: visualFollowupHeaders(),
      body: JSON.stringify({
        idempotency_key: input.idempotency_key,
        kind: 'screenshot',
        source: input.source,
        readable_url: readableUrl,
        mime: input.mime,
        prompt_text: input.prompt_text
      })
    });
    const body = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok || body.ok !== true || !isRecord(body.visual_followup)) {
      return { state: 'failed', sent_to_provider: false, provider_visible: false, reason: `visual_followup_request_failed:${response.status}:${String(body.error ?? 'bad_response')}` };
    }
    return normalizeVisualFollowupContract(body.visual_followup, input.public_base_url);
  } catch (error) {
    return { state: 'failed', sent_to_provider: false, provider_visible: false, reason: `visual_followup_request_exception:${error instanceof Error ? error.message : String(error)}` };
  }
}

function screenshotReadableUrl(screenshot: Record<string, unknown>): string | undefined {
  const candidates = [
    nestedString(screenshot, ['preview', 'readable_url']),
    nestedString(screenshot, ['preview', 'url']),
    nestedString(screenshot, ['artifact', 'preview', 'readable_url']),
    nestedString(screenshot, ['artifact', 'preview', 'url']),
    nestedString(screenshot, ['full', 'readable_url']),
    nestedString(screenshot, ['artifact', 'full', 'readable_url'])
  ];
  return candidates.find((value) => typeof value === 'string' && /^https:\/\//.test(value));
}

function visualFollowupInput(params: Record<string, unknown>, readableUrl: string) {
  const visual = isRecord(params.visual_followup) ? params.visual_followup : {};
  const job_id = stringValue(visual.job_id) ?? stringValue(params.threaddex_job_id) ?? stringValue(params.job_id);
  const base_url = stripTrailingSlash(stringValue(visual.base_url) ?? stringValue(params.threaddex_base_url) ?? process.env.THREADEX_VISUAL_FOLLOWUP_BASE_URL ?? process.env.THREADEX_JOB_API_BASE_URL ?? 'http://127.0.0.1:33988');
  const public_base_url = stripTrailingSlash(stringValue(visual.public_base_url) ?? process.env.THREADEX_VISUAL_FOLLOWUP_PUBLIC_BASE_URL ?? '');
  const idempotency_key = stringValue(visual.idempotency_key) ?? `cua-screenshot:${job_id ?? 'unknown'}:${createHash('sha256').update(readableUrl).digest('hex').slice(0, 16)}`;
  const source = stringValue(visual.source) ?? stringValue(params.source) ?? 'cua_driver';
  const mime = stringValue(visual.mime) ?? stringValue(params.mime) ?? 'image/webp';
  const prompt_text = stringValue(visual.prompt_text) ?? stringValue(params.prompt_text) ?? `Parse this job image NOW: ${readableUrl}`;
  return { job_id, base_url, public_base_url, idempotency_key, source, mime, prompt_text };
}

function normalizeVisualFollowupContract(contract: Record<string, unknown>, publicBaseUrl: string) {
  const out = { ...contract } as Record<string, unknown>;
  out.sent_to_provider = contract.sent_to_provider === true;
  out.provider_visible = contract.provider_visible === true;
  if (publicBaseUrl && typeof contract.status_path === 'string') out.status_url = `${publicBaseUrl}${contract.status_path}`;
  out.instruction = out.sent_to_provider === true
    ? 'The screenshot URL has been sent as a visible follow-up prompt. Continue using the visible screenshot follow-up.'
    : 'Do not claim visual inspection yet. Poll visual_followup.status_url until sent_to_provider is true.';
  return out;
}

function visualFollowupHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const bearer = process.env.THREADEX_VISUAL_FOLLOWUP_BEARER_TOKEN ?? process.env.THREADEX_JOB_API_BEARER_TOKEN;
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  return headers;
}

function nestedString(value: Record<string, unknown>, pathParts: string[]): string | undefined {
  let current: unknown = value;
  for (const part of pathParts) {
    if (!isRecord(current)) return undefined;
    current = current[part];
  }
  return typeof current === 'string' && current ? current : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/$/, '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasScreenshotPayload(value: Record<string, unknown>) {
  return ['data', 'base64', 'image', 'image_base64', 'bytes', 'path', 'file'].some((key) => typeof value[key] === 'string' && String(value[key]).length > 0) || Boolean(value.artifact);
}

async function cleanupScreenshotArtifacts(workspace: Workspace, params: Record<string, unknown>) {
  const olderThanSeconds = optionalNonNegativeNumber(params.cleanup_screenshots_older_than_seconds, DEFAULT_SCREENSHOT_CLEANUP_OLDER_THAN_SECONDS);
  const keepLatest = optionalNonNegativeNumber(params.keep_latest_screenshots, DEFAULT_SCREENSHOT_KEEP_LATEST);
  if (olderThanSeconds === null && keepLatest === null) return null;

  const dir = screenshotArtifactDir(workspace);
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const screenshots: Array<{ name: string; absolute: string; mtimeMs: number }> = [];
  for (const entry of entries) {
    if (!entry.isFile() || !isManagedScreenshotName(entry.name)) continue;
    const absolute = path.join(dir, entry.name);
    const info = await stat(absolute).catch(() => null);
    if (info?.isFile()) screenshots.push({ name: entry.name, absolute, mtimeMs: info.mtimeMs });
  }

  const now = Date.now();
  const sorted = screenshots.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const keep = new Set(sorted.slice(0, keepLatest ?? sorted.length).map((item) => item.absolute));
  const toDelete = sorted.filter((item) => {
    if (keep.has(item.absolute)) return false;
    if (keepLatest !== null && screenshots.length > keepLatest) return true;
    if (olderThanSeconds === null) return false;
    return now - item.mtimeMs > olderThanSeconds * 1000;
  });

  let deleted = 0;
  for (const item of toDelete) {
    await rm(item.absolute, { force: true }).then(() => { deleted += 1; }, () => undefined);
  }
  return { enabled: true, directory: agentRelativePath(workspace, dir), pattern: `${SCREENSHOT_ARTIFACT_PREFIX}*`, older_than_seconds: olderThanSeconds, keep_latest: keepLatest, scanned: screenshots.length, deleted, retained: Math.max(0, screenshots.length - deleted) };
}

function optionalNonNegativeNumber(value: unknown, fallback: number | null) {
  if (value === undefined || value === null) return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return fallback;
  return Math.floor(number);
}

function isManagedScreenshotName(name: string) {
  return name.startsWith(SCREENSHOT_ARTIFACT_PREFIX) && (name.endsWith(SCREENSHOT_FULL_SUFFIX) || name.endsWith(SCREENSHOT_PREVIEW_SUFFIX)) && !name.includes('/') && !name.includes('..');
}

async function captureScreenshotArtifact(workspace: Workspace) {
  if (process.platform !== 'darwin') return null;
  const paths = screenshotArtifactPaths(workspace);
  await ensureScreenshotArtifactDir(paths.full);
  await execFileAsync('/usr/sbin/screencapture', ['-x', paths.full], { timeout: 15000, maxBuffer: 1024 * 1024 });
  return screenshotArtifactPair(workspace, paths.full, await writeWebpPreview(paths.full, paths.preview));
}

async function writeBase64ScreenshotArtifact(workspace: Workspace, base64: string) {
  const paths = screenshotArtifactPaths(workspace);
  await ensureScreenshotArtifactDir(paths.full);
  await writeFile(paths.full, Buffer.from(base64, 'base64'));
  return screenshotArtifactPair(workspace, paths.full, await writeWebpPreview(paths.full, paths.preview));
}

function screenshotArtifactDir(workspace: Workspace) {
  return path.join(workspace.realAgentDir, 'artifacts', 'screenshots');
}

function windowStateArtifactDir(workspace: Workspace) {
  return path.join(workspace.realAgentDir, 'artifacts', 'window-state');
}

function screenshotArtifactPaths(workspace: Workspace) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const base = `${SCREENSHOT_ARTIFACT_PREFIX}${stamp}`;
  const dir = screenshotArtifactDir(workspace);
  return { full: path.join(dir, `${base}${SCREENSHOT_FULL_SUFFIX}`), preview: path.join(dir, `${base}${SCREENSHOT_PREVIEW_SUFFIX}`) };
}

async function writeWindowStateTextArtifact(workspace: Workspace, content: string) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const absolutePath = path.join(windowStateArtifactDir(workspace), `${WINDOW_STATE_ARTIFACT_PREFIX}${stamp}${WINDOW_STATE_ARTIFACT_SUFFIX}`);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content);
  return textArtifact(workspace, absolutePath, 'text/markdown');
}

async function writeWebpPreview(fullPath: string, previewPath: string) {
  const image = sharp(fullPath);
  const metadata = await image.metadata();
  if (!metadata.width || !metadata.height) throw new Error('screenshot preview generation failed: missing image dimensions');
  const width = Math.max(1, Math.floor(metadata.width / 2));
  const height = Math.max(1, Math.floor(metadata.height / 2));
  await image.resize({ width, height }).webp({ quality: SCREENSHOT_WEBP_QUALITY }).toFile(previewPath);
  return previewPath;
}

async function ensureScreenshotArtifactDir(absolutePath: string) {
  await mkdir(path.dirname(absolutePath), { recursive: true });
}

function screenshotArtifactPair(workspace: Workspace, fullPath: string, previewPath: string) {
  return {
    kind: 'screenshot',
    full: screenshotArtifact(workspace, fullPath, 'png'),
    preview: screenshotArtifact(workspace, previewPath, 'webp', { quality: SCREENSHOT_WEBP_QUALITY, scale: 0.5 }),
    default: 'preview'
  };
}

function textArtifact(workspace: Workspace, absolutePath: string, mediaType: string, extra: Record<string, unknown> = {}) {
  const workspacePath = workspaceRelativePath(workspace, absolutePath);
  const agentPath = agentRelativePath(workspace, absolutePath);
  const url = artifactUrl(workspace, agentPath);
  return {
    kind: 'text',
    format: 'markdown',
    media_type: mediaType,
    path: workspacePath,
    agent_artifact_path: agentPath,
    url_path: artifactUrlPath(workspace, agentPath),
    url,
    readable_url: url,
    ...extra
  };
}

function screenshotArtifact(workspace: Workspace, absolutePath: string, format: 'png' | 'webp', extra: Record<string, unknown> = {}) {
  const workspacePath = workspaceRelativePath(workspace, absolutePath);
  const agentPath = agentRelativePath(workspace, absolutePath);
  const url = artifactUrl(workspace, agentPath);
  return {
    kind: 'image',
    format,
    path: workspacePath,
    agent_artifact_path: agentPath,
    url_path: artifactUrlPath(workspace, agentPath),
    url,
    readable_url: url,
    ...extra
  };
}

function artifactUrlPath(workspace: Workspace, workspacePath: string) {
  return `/api/v1/artifacts/${encodeURIComponent(workspace.id)}/${encodeURIComponent(workspacePath)}`;
}

function artifactUrl(workspace: Workspace, workspacePath: string) {
  const base = (process.env.OTA_GATEWAY_PUBLIC_BASE_URL ?? '').replace(/\/$/, '');
  return base ? signedArtifactUrl(base, artifactUrlPath(workspace, workspacePath)) : undefined;
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
