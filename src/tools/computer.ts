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
  const sanitizedParams = sanitizeCuaArgs(params);
  const result = await cuaCall(method, sanitizedParams);
  return ok('cua driver call', { method, read_only: readOnly, result: await boundCuaResult(workspace, method, result, sanitizedParams) });
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
      readable_url: readableUrl,
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
      return { state: 'failed', sent_to_provider: false, provider_visible: false, reason: `visual_followup_request_failed:${response.status}:${String(body.error ?? 'bad_response')}`, readable_url: readableUrl };
    }
    return normalizeVisualFollowupContract(body.visual_followup, input.public_base_url, readableUrl);
  } catch (error) {
    return { state: 'failed', sent_to_provider: false, provider_visible: false, reason: `visual_followup_request_exception:${error instanceof Error ? error.message : String(error)}`, readable_url: readableUrl };
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
  const source = stringValue(visual.source) ?? 'cua_driver';
  const mime = stringValue(visual.mime) ?? 'image/webp';
  const prompt_text = stringValue(visual.prompt_text) ?? `Screenshot follow-up for the current active job:\nscreenshot readable url: ${readableUrl}\nUse this screenshot as visual input for the current job. Do not claim the screenshot is missing if this visible follow-up is present.`;
  return { job_id, base_url, public_base_url, idempotency_key, source, mime, prompt_text };
}

function normalizeVisualFollowupContract(contract: Record<string, unknown>, publicBaseUrl: string, readableUrl: string) {
  const out = { ...contract } as Record<string, unknown>;
  out.sent_to_provider = contract.sent_to_provider === true;
  out.provider_visible = contract.provider_visible === true;
  out.readable_url = readableUrl;
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
