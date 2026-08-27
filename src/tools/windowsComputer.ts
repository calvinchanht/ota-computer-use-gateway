import { execFile } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { promisify } from 'node:util';
import { ok } from '../core/result.js';
import { platformInfo } from '../core/platform.js';
import type { Workspace } from '../core/workspaces.js';
import { agentPath } from '../core/agentDir.js';
import { signedArtifactUrl } from '../server/artifactSignatures.js';
import { screenshotVisualFollowup } from './computer.js';

const execFileAsync = promisify(execFile);
const MAX_POWERSHELL_BUFFER = 8 * 1024 * 1024;
const MAX_BATCH_STEPS = 50;
const SCREENSHOT_PREFIX = 'windows-screenshot-';
const SCREENSHOT_SEQUENCE_PREFIX = 'windows-screenshot-sequence-';
const DEFAULT_SEQUENCE_COUNT = 8;
const DEFAULT_SEQUENCE_INTERVAL_MS = 250;
const MAX_SEQUENCE_COUNT = 8;
const MAX_SEQUENCE_DURATION_MS = 5000;

export type WindowsBatchStep =
  | { tool: string; args?: Record<string, unknown> }
  | { delay_ms: number };

export interface WindowsUiaSelector {
  automation_id?: string;
  name?: string;
  control_type?: string;
}

export async function windowsComputerStatus(workspace: Workspace) {
  return ok('windows computer status', {
    workspace_id: workspace.id,
    platform: platformInfo(),
    adapter: 'windows-native-powershell-win32-uia',
    host_supported: process.platform === 'win32',
    capabilities: workspace.windows_computer
  });
}

export async function windowsListMonitors(workspace: Workspace) {
  ensureEnabled(workspace);
  ensureWindows();
  return ok('windows monitors', await psJson(monitorScript()));
}

export async function windowsScreenshot(workspace: Workspace, monitor = 'primary', params: Record<string, unknown> = {}) {
  ensureEnabled(workspace);
  ensureCapability(workspace, 'allow_screenshot');
  ensureMonitorAllowed(workspace, monitor);
  ensureWindows();
  const paths = screenshotPaths(workspace);
  await mkdir(path.dirname(paths.full), { recursive: true });
  const data = await psObject(screenshotScript(paths.full, monitor));
  const preview = await writePreview(paths.full, paths.preview);
  const artifact = artifactPair(workspace, paths.full, preview);
  const payload = {
    ...data,
    artifact,
    preview: artifact.preview,
    full: artifact.full
  };
  const visualFollowup = await screenshotVisualFollowup(payload, { ...params, source: 'windows_computer', attachment_path: paths.preview });
  return ok('windows screenshot', windowsScreenshotResponse(data, visualFollowup));
}

export async function windowsWindowScreenshot(workspace: Workspace, hwnd: number, params: Record<string, unknown> = {}) {
  ensureEnabled(workspace);
  ensureCapability(workspace, 'allow_screenshot');
  ensureCapability(workspace, 'allow_window_management');
  const target = integer(hwnd, 'hwnd');
  ensureWindows();
  const paths = screenshotPaths(workspace);
  await mkdir(path.dirname(paths.full), { recursive: true });
  const data = await psObject(windowScreenshotScript(paths.full, target));
  const preview = await writePreview(paths.full, paths.preview);
  const artifact = artifactPair(workspace, paths.full, preview);
  const payload = { ...data, artifact, preview: artifact.preview, full: artifact.full };
  const visualFollowup = await screenshotVisualFollowup(payload, { ...params, source: 'windows_computer', attachment_path: paths.preview });
  return ok('windows window screenshot', windowsScreenshotResponse(data, visualFollowup));
}

export async function windowsWindowScreenshotSequence(workspace: Workspace, hwnd: number, intervalMs = DEFAULT_SEQUENCE_INTERVAL_MS, count = DEFAULT_SEQUENCE_COUNT, params: Record<string, unknown> = {}) {
  ensureEnabled(workspace);
  ensureCapability(workspace, 'allow_screenshot');
  ensureCapability(workspace, 'allow_window_management');
  const target = integer(hwnd, 'hwnd');
  const interval = boundedInteger(intervalMs, 'interval_ms', 50, MAX_SEQUENCE_DURATION_MS);
  const frameCount = boundedInteger(count, 'count', 2, MAX_SEQUENCE_COUNT);
  const requestedDurationMs = interval * (frameCount - 1);
  if (requestedDurationMs > MAX_SEQUENCE_DURATION_MS) throw new Error(`screenshot sequence duration must be at most ${MAX_SEQUENCE_DURATION_MS}ms`);
  ensureWindows();
  const started = Date.now();
  const { frames, attachmentPaths, firstPayload } = await captureWindowScreenshotSequence(workspace, target, interval, frameCount, started);
  const promptText = `Analyze these ${frameCount} ordered screenshot frames as one temporal sequence. Frames are attached in frame_01 through frame_${String(frameCount).padStart(2, '0')} order at ${interval}ms requested intervals. Compare motion, transitions, transient UI, and drift. Reference image: ${String((firstPayload?.preview as Record<string, unknown> | undefined)?.readable_url ?? '')}`;
  const visualFollowup = firstPayload
    ? await screenshotVisualFollowup(firstPayload, { ...params, kind: 'screenshot_sequence', source: 'windows_computer', attachment_paths: attachmentPaths, prompt_text: promptText })
    : { state: 'not_available', sent_to_provider: false, provider_visible: false, reason: 'sequence_capture_empty' };
  return ok('windows window screenshot sequence', {
    hwnd: target,
    count: frameCount,
    interval_ms: interval,
    requested_duration_ms: requestedDurationMs,
    capture_elapsed_ms: Date.now() - started,
    frames,
    visual_followup: windowsVisualFollowupResponse(visualFollowup)
  });
}


async function captureWindowScreenshotSequence(workspace: Workspace, target: number, interval: number, frameCount: number, started: number) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const frames: Array<Record<string, unknown>> = [];
  const attachmentPaths: string[] = [];
  let firstPayload: Record<string, unknown> | undefined;
  await mkdir(screenshotArtifactDir(workspace), { recursive: true });
  for (let index = 0; index < frameCount; index++) {
    const waitMs = started + (index * interval) - Date.now();
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
    const paths = screenshotSequenceFramePaths(workspace, stamp, index + 1);
    const data = await psObject(windowScreenshotScript(paths.full, target));
    const preview = await writePreview(paths.full, paths.preview);
    const pair = artifactPair(workspace, paths.full, preview);
    frames.push({
      frame: `frame_${String(index + 1).padStart(2, '0')}`,
      index: index + 1,
      captured_at: typeof data.captured_at === 'string' ? data.captured_at : new Date().toISOString(),
      elapsed_ms: Date.now() - started,
      bounds: data.bounds,
      capture_method: data.capture_method,
      artifact: sequenceArtifactResponse(pair)
    });
    attachmentPaths.push(paths.preview);
    if (!firstPayload) firstPayload = { ...data, artifact: pair, preview: pair.preview, full: pair.full };
  }
  return { frames, attachmentPaths, firstPayload };
}

function windowsScreenshotResponse(data: Record<string, unknown>, visualFollowup: unknown) {
  return {
    monitor: data.monitor,
    hwnd: data.hwnd,
    bounds: data.bounds,
    capture_method: data.capture_method,
    visual_followup: windowsVisualFollowupResponse(visualFollowup)
  };
}

function windowsVisualFollowupResponse(value: unknown) {
  if (!isRecord(value)) return value;
  const { readable_url: _readableUrl, ...rest } = value;
  return rest;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export async function windowsUiaTree(workspace: Workspace, maxNodes = 120, hwnd?: number) {
  ensureEnabled(workspace);
  ensureCapability(workspace, 'allow_uia_tree');
  const limit = boundedInteger(maxNodes, 'max_nodes', 1, 1000);
  const target = hwnd === undefined ? undefined : integer(hwnd, 'hwnd');
  ensureWindows();
  return ok('windows uia tree', await psJson(uiaTreeScript(limit, target)));
}

export async function windowsListWindows(workspace: Workspace) {
  ensureEnabled(workspace);
  ensureCapability(workspace, 'allow_window_management');
  ensureWindows();
  return ok('windows windows', await psJson(listWindowsScript()));
}

export async function windowsFocusWindow(workspace: Workspace, hwnd: number) {
  ensureEnabled(workspace);
  ensureCapability(workspace, 'allow_window_management');
  const target = integer(hwnd, 'hwnd');
  ensureWindows();
  return ok('windows focus window', await psJson(focusWindowScript(target)));
}

export async function windowsPlaceWindow(workspace: Workspace, hwnd: number, monitor = 'primary', x = 0, y = 0, width?: number, height?: number) {
  ensureEnabled(workspace);
  ensureCapability(workspace, 'allow_window_management');
  ensureMonitorAllowed(workspace, monitor);
  const target = integer(hwnd, 'hwnd');
  const offset = screenPoint(x, y);
  const size = optionalSize(width, height);
  ensureWindows();
  return ok('windows placed window', await psJson(placeWindowScript(target, monitor, offset.x, offset.y, size.width, size.height)));
}

export async function windowsUiaRead(workspace: Workspace, hwnd: number, selector: WindowsUiaSelector, maxChars = 20000) {
  ensureEnabled(workspace);
  ensureCapability(workspace, 'allow_uia_tree');
  const target = integer(hwnd, 'hwnd');
  const normalized = normalizeUiaSelector(selector);
  const limit = boundedInteger(maxChars, 'max_chars', 1, 200000);
  ensureWindows();
  return ok('windows uia value', await psJson(uiaReadScript(target, normalized, limit)));
}

export async function windowsUiaSetValue(workspace: Workspace, hwnd: number, selector: WindowsUiaSelector, value: string) {
  ensureEnabled(workspace);
  ensureCapability(workspace, 'allow_uia_tree');
  ensureCapability(workspace, 'allow_keyboard');
  const target = integer(hwnd, 'hwnd');
  const normalized = normalizeUiaSelector(selector);
  ensureWindows();
  return ok('windows uia value set', await psJson(uiaSetValueScript(target, normalized, value)));
}

export async function windowsLaunchApp(workspace: Workspace, filePath: string, args: string[] = [], cwd?: string) {
  ensureEnabled(workspace);
  ensureCapability(workspace, 'allow_app_launch');
  if (!filePath.trim()) throw new Error('file_path must be a non-empty string');
  ensureWindows();
  return ok('windows app launched', await psJson(launchScript(filePath, args, cwd)));
}

export async function windowsClick(workspace: Workspace, x: number, y: number, button = 'left') {
  ensureEnabled(workspace);
  ensureCapability(workspace, 'allow_mouse');
  const point = screenPoint(x, y);
  const mouseButton = buttonName(button);
  ensureWindows();
  return ok('windows click', await psJson(mouseClickScript(point.x, point.y, mouseButton)));
}

export async function windowsMouseMove(workspace: Workspace, x: number, y: number) {
  ensureEnabled(workspace);
  ensureCapability(workspace, 'allow_mouse');
  const point = screenPoint(x, y);
  ensureWindows();
  return ok('windows mouse move', await psJson(mouseMoveScript(point.x, point.y)));
}

export async function windowsDoubleClick(workspace: Workspace, x: number, y: number, button = 'left') {
  ensureEnabled(workspace);
  ensureCapability(workspace, 'allow_mouse');
  const point = screenPoint(x, y);
  const mouseButton = buttonName(button);
  ensureWindows();
  await psJson(mouseClickScript(point.x, point.y, mouseButton));
  return ok('windows double click', await psJson(mouseClickScript(point.x, point.y, mouseButton)));
}

export async function windowsDrag(workspace: Workspace, fromX: number, fromY: number, toX: number, toY: number, durationMs?: number, steps?: number) {
  ensureEnabled(workspace);
  ensureCapability(workspace, 'allow_mouse');
  const from = screenPoint(fromX, fromY, 'from');
  const to = screenPoint(toX, toY, 'to');
  const timing = dragTiming(durationMs, steps);
  ensureWindows();
  return ok('windows drag', await psJson(mouseDragScript(from.x, from.y, to.x, to.y, timing.duration_ms, timing.steps)));
}

export async function windowsScroll(workspace: Workspace, x: number, y: number, delta: number) {
  ensureEnabled(workspace);
  ensureCapability(workspace, 'allow_mouse');
  const point = screenPoint(x, y);
  const scrollDelta = finiteNumber(delta, 'delta');
  ensureWindows();
  return ok('windows scroll', await psJson(mouseScrollScript(point.x, point.y, scrollDelta)));
}

export async function windowsWindowClick(workspace: Workspace, hwnd: number, x: number, y: number, button = 'left', coordinateSpace = 'client', focus = true) {
  ensureWindowMouse(workspace, hwnd, x, y, coordinateSpace);
  const mouseButton = buttonName(button);
  return ok('windows window click', await psJson(windowClickScript(integer(hwnd, 'hwnd'), finiteNumber(x, 'x'), finiteNumber(y, 'y'), mouseButton, coordinateSpaceName(coordinateSpace), Boolean(focus))));
}

export async function windowsWindowDoubleClick(workspace: Workspace, hwnd: number, x: number, y: number, button = 'left', coordinateSpace = 'client', focus = true) {
  const first = await windowsWindowClick(workspace, hwnd, x, y, button, coordinateSpace, focus);
  const second = await windowsWindowClick(workspace, hwnd, x, y, button, coordinateSpace, focus);
  return ok('windows window double click', { first: first.data, second: second.data });
}

export async function windowsWindowMouseMove(workspace: Workspace, hwnd: number, x: number, y: number, coordinateSpace = 'client', focus = false) {
  ensureWindowMouse(workspace, hwnd, x, y, coordinateSpace);
  return ok('windows window mouse move', await psJson(windowMoveScript(integer(hwnd, 'hwnd'), finiteNumber(x, 'x'), finiteNumber(y, 'y'), coordinateSpaceName(coordinateSpace), Boolean(focus))));
}

export async function windowsWindowDrag(workspace: Workspace, hwnd: number, fromX: number, fromY: number, toX: number, toY: number, coordinateSpace = 'client', focus = true, durationMs?: number, steps?: number) {
  const timing = dragTiming(durationMs, steps);
  ensureWindowMouse(workspace, hwnd, fromX, fromY, coordinateSpace);
  const to = screenPoint(toX, toY, 'to');
  return ok('windows window drag', await psJson(windowDragScript(integer(hwnd, 'hwnd'), finiteNumber(fromX, 'from_x'), finiteNumber(fromY, 'from_y'), to.x, to.y, coordinateSpaceName(coordinateSpace), Boolean(focus), timing.duration_ms, timing.steps)));
}

export async function windowsWindowScroll(workspace: Workspace, hwnd: number, x: number, y: number, delta: number, coordinateSpace = 'client', focus = true) {
  ensureWindowMouse(workspace, hwnd, x, y, coordinateSpace);
  const scrollDelta = finiteNumber(delta, 'delta');
  return ok('windows window scroll', await psJson(windowScrollScript(integer(hwnd, 'hwnd'), finiteNumber(x, 'x'), finiteNumber(y, 'y'), scrollDelta, coordinateSpaceName(coordinateSpace), Boolean(focus))));
}

export async function windowsTypeText(workspace: Workspace, text: string, hwnd?: number) {
  ensureEnabled(workspace);
  ensureCapability(workspace, 'allow_keyboard');
  const target = optionalHwnd(workspace, hwnd);
  ensureWindows();
  return ok('windows typed text', await psJson(typeTextScript(text, target)));
}

export async function windowsKey(workspace: Workspace, key: string, hwnd?: number) {
  ensureEnabled(workspace);
  ensureCapability(workspace, 'allow_keyboard');
  const target = optionalHwnd(workspace, hwnd);
  ensureWindows();
  return ok('windows key', await psJson(sendKeysScript(key, target)));
}

export async function windowsHotkey(workspace: Workspace, keys: string[], hwnd?: number) {
  ensureEnabled(workspace);
  ensureCapability(workspace, 'allow_keyboard');
  const target = optionalHwnd(workspace, hwnd);
  ensureWindows();
  return ok('windows hotkey', await psJson(sendKeysScript(hotkeySequence(keys), target)));
}

export async function windowsClipboardGet(workspace: Workspace) {
  ensureEnabled(workspace);
  ensureCapability(workspace, 'allow_clipboard');
  ensureWindows();
  return ok('windows clipboard', await psJson(clipboardGetScript()));
}

export async function windowsClipboardSet(workspace: Workspace, text: string) {
  ensureEnabled(workspace);
  ensureCapability(workspace, 'allow_clipboard');
  ensureWindows();
  return ok('windows clipboard set', await psJson(clipboardSetScript(text)));
}

export async function windowsBatch(workspace: Workspace, calls: WindowsBatchStep[]) {
  if (!Array.isArray(calls) || calls.length === 0) throw new Error('windows batch requires at least one step');
  if (calls.length > MAX_BATCH_STEPS) throw new Error(`windows batch supports at most ${MAX_BATCH_STEPS} steps`);
  const results: unknown[] = [];
  for (const [index, call] of calls.entries()) {
    const result = await runBatchStep(workspace, call, index);
    results.push(result);
    if ('error' in result) break;
  }
  const failed = results.find((row) => typeof row === 'object' && row && 'error' in row) ?? null;
  return ok(failed ? 'windows batch stopped on error' : 'windows batch completed', { results, stopped_on_error: failed });
}

async function runBatchStep(workspace: Workspace, step: WindowsBatchStep, index: number) {
  const started = Date.now();
  if ('delay_ms' in step) return delayStep(step.delay_ms, index, started);
  try { return { index, tool: step.tool, result: await runNamedTool(workspace, step.tool, step.args ?? {}), elapsed_ms: Date.now() - started }; }
  catch (error) { return { index, tool: step.tool, error: errorMessage(error), elapsed_ms: Date.now() - started }; }
}

async function runNamedTool(workspace: Workspace, tool: string, args: Record<string, unknown>) {
  if (tool === 'mouse_move') return windowsMouseMove(workspace, num(args.x), num(args.y));
  if (tool === 'click') return windowsClick(workspace, num(args.x), num(args.y), str(args.button, 'left'));
  if (tool === 'double_click') return windowsDoubleClick(workspace, num(args.x), num(args.y), str(args.button, 'left'));
  if (tool === 'drag') return windowsDrag(workspace, num(args.from_x), num(args.from_y), num(args.to_x), num(args.to_y), optionalNum(args.duration_ms), optionalNum(args.steps));
  if (tool === 'scroll') return windowsScroll(workspace, num(args.x), num(args.y), num(args.delta));
  if (tool === 'window_click') return windowsWindowClick(workspace, num(args.hwnd), num(args.x), num(args.y), str(args.button, 'left'), str(args.coordinate_space, 'client'), bool(args.focus, true));
  if (tool === 'window_mouse_move') return windowsWindowMouseMove(workspace, num(args.hwnd), num(args.x), num(args.y), str(args.coordinate_space, 'client'), bool(args.focus, false));
  if (tool === 'window_drag') return windowsWindowDrag(workspace, num(args.hwnd), num(args.from_x), num(args.from_y), num(args.to_x), num(args.to_y), str(args.coordinate_space, 'client'), bool(args.focus, true), optionalNum(args.duration_ms), optionalNum(args.steps));
  if (tool === 'window_scroll') return windowsWindowScroll(workspace, num(args.hwnd), num(args.x), num(args.y), num(args.delta), str(args.coordinate_space, 'client'), bool(args.focus, true));
  if (tool === 'type_text') return windowsTypeText(workspace, str(args.text), optionalNum(args.hwnd));
  if (tool === 'key') return windowsKey(workspace, str(args.key), optionalNum(args.hwnd));
  if (tool === 'hotkey') return windowsHotkey(workspace, arr(args.keys), optionalNum(args.hwnd));
  throw new Error(`unsupported windows batch tool: ${tool}`);
}

function ensureWindows() {
  if (process.platform !== 'win32') throw new Error('windows computer-use tools require a Windows host');
}

function ensureEnabled(workspace: Workspace) {
  if (!workspace.windows_computer?.enabled) throw new Error('windows computer-use is not enabled for this workspace');
}

function ensureCapability(workspace: Workspace, key: keyof Workspace['windows_computer']) {
  if (!workspace.windows_computer?.[key]) throw new Error(`windows computer-use capability disabled: ${key}`);
}

function ensureMonitorAllowed(workspace: Workspace, monitor: string) {
  if (!workspace.windows_computer?.allow_multi_monitor && !['primary', '0'].includes(String(monitor))) throw new Error('multi-monitor access is disabled');
}

function ensureWindowMouse(workspace: Workspace, hwnd: unknown, x: unknown, y: unknown, coordinateSpace: unknown) {
  ensureEnabled(workspace);
  ensureCapability(workspace, 'allow_mouse');
  ensureCapability(workspace, 'allow_window_management');
  integer(hwnd, 'hwnd');
  screenPoint(x, y);
  coordinateSpaceName(coordinateSpace);
  ensureWindows();
}

export function windowsPowerShellJsonScript(script: string) {
  return `$ProgressPreference='SilentlyContinue'; [Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false); $OutputEncoding=[Console]::OutputEncoding; ${script}`;
}

async function psJson(script: string): Promise<unknown> {
  const encoded = Buffer.from(windowsPowerShellJsonScript(script), 'utf16le').toString('base64');
  const { stdout, stderr } = await execFileAsync('powershell.exe', ['-NoProfile', '-Sta', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], { timeout: 30000, maxBuffer: MAX_POWERSHELL_BUFFER });
  const text = stdout.trim();
  if (!text) throw new Error(`PowerShell command returned no JSON${stderr.trim() ? `: ${stderr.trim()}` : ''}`);
  return JSON.parse(text);
}

async function psObject(script: string): Promise<Record<string, unknown>> {
  const data = await psJson(script);
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('PowerShell command did not return an object');
  return data as Record<string, unknown>;
}

function monitorScript() {
  return `${formsAssemblies()}; ${screenObjFn()}; [System.Windows.Forms.Screen]::AllScreens | ForEach-Object { screenObj $_ } | ConvertTo-Json -Depth 5`;
}

function screenshotScript(file: string, monitor: string) {
  return `${formsAssemblies()}; ${screenObjFn()}; ${boundsFn()}; ${captureFn()}; $b = bounds ${q(monitor)}; capture $b ${q(file)}; @{ monitor=${q(monitor)}; bounds=rectObj $b; path=${q(file)} } | ConvertTo-Json -Depth 5`;
}

function windowScreenshotScript(file: string, hwnd: number) {
  return `${formsAssemblies()}; ${win32WindowTypes()}; ${windowCaptureTypes()}; $focus=[Win32Windows]::Focus([IntPtr]${int(hwnd)}); $result=captureWindow ${int(hwnd)} ${q(file)}; $result.focus=$focus; $result | ConvertTo-Json -Depth 6`;
}

function uiaTreeScript(maxNodes: number, hwnd?: number) {
  const root = hwnd === undefined ? '[System.Windows.Automation.AutomationElement]::RootElement' : `[System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]${int(hwnd)})`;
  return `${uiaAssemblies()}; ${uiaWalkFn()}; $root=${root}; if($root -eq $null){throw 'UI Automation root not found'}; $out=New-Object System.Collections.ArrayList; walk $root 0 ${Math.max(1, Math.trunc(maxNodes))} $out; @{ hwnd=${psOptionalLiteral(hwnd)}; nodes=$out; count=$out.Count; truncated=($out.Count -ge ${Math.max(1, Math.trunc(maxNodes))}) } | ConvertTo-Json -Depth 8`;
}

function listWindowsScript() {
  return `${win32WindowTypes()}; $items=@([Win32Windows]::List()); if($items.Count -eq 0){'[]'} else {$items | ConvertTo-Json -Depth 5}`;
}

function focusWindowScript(hwnd: number) {
  return `${win32WindowTypes()}; [Win32Windows]::Focus([IntPtr]${Math.trunc(hwnd)}) | ConvertTo-Json -Depth 5`;
}

function placeWindowScript(hwnd: number, monitor: string, x: number, y: number, width?: number, height?: number) {
  return `${formsAssemblies()}; ${win32WindowTypes()}; ${windowPlacementTypes()}; ${resolveMonitorFn()}; $s=resolveMonitor ${q(monitor)}; $a=$s.WorkingArea; $w=${psOptionalNumber(width, '$a.Width')}; $h=${psOptionalNumber(height, '$a.Height')}; $ok=[Win32Placement]::Place([IntPtr]${int(hwnd)},$a.X+${int(x)},$a.Y+${int(y)},$w,$h); if(-not $ok){throw 'MoveWindow failed'}; $focus=[Win32Windows]::Focus([IntPtr]${int(hwnd)}); @{ hwnd=${int(hwnd)}; monitor=$s.DeviceName; bounds=@{x=$a.X+${int(x)};y=$a.Y+${int(y)};width=$w;height=$h}; focused=$focus.focused; foreground_hwnd=$focus.foreground_hwnd } | ConvertTo-Json -Depth 5`;
}

function uiaReadScript(hwnd: number, selector: Required<WindowsUiaSelector>, maxChars: number) {
  return `${uiaAssemblies()}; ${uiaRectObjFn()}; ${uiaSelectorFn()}; $matches=findUiaElements ${int(hwnd)} ${q(selector.automation_id)} ${q(selector.name)} ${q(selector.control_type)}; if($matches.Count -eq 0){throw 'UI Automation element not found for selector'}; $e=$matches[0]; $source='name'; $text=$e.Current.Name; $patterns=@($e.GetSupportedPatterns() | ForEach-Object {$_.ProgrammaticName}); try{$p=$e.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern);$source='value';$text=$p.Current.Value}catch{}; if($source -eq 'name'){try{$p=$e.GetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern);$source='text';$text=$p.DocumentRange.GetText(${int(maxChars)})}catch{}}; if($source -eq 'name'){try{$p=$e.GetCurrentPattern([System.Windows.Automation.LegacyIAccessiblePattern]::Pattern);$source='legacy_value';$text=$p.Current.Value}catch{}}; if($null -eq $text){$text=''}; if($text.Length -gt ${int(maxChars)}){$text=$text.Substring(0,${int(maxChars)})}; $b=uiaRectObj $e.Current.BoundingRectangle; @{ hwnd=${int(hwnd)}; match_count=$matches.Count; automation_id=$e.Current.AutomationId; name=$e.Current.Name; control_type=($e.Current.ControlType.ProgrammaticName -replace '^ControlType\\.'); enabled=$e.Current.IsEnabled; offscreen=$e.Current.IsOffscreen; bounds=$b.bounds; bounds_finite=$b.bounds_finite; bounds_empty=$b.bounds_empty; source=$source; text=$text; supported_patterns=$patterns; truncated=($text.Length -ge ${int(maxChars)}) } | ConvertTo-Json -Depth 6`;
}

function uiaSetValueScript(hwnd: number, selector: Required<WindowsUiaSelector>, value: string) {
  return `${formsAssemblies()}; ${uiaAssemblies()}; ${win32WindowTypes()}; ${uiaSelectorFn()}; $e=findUiaElement ${int(hwnd)} ${q(selector.automation_id)} ${q(selector.name)} ${q(selector.control_type)}; $method=''; try{$p=$e.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern);if($p.Current.IsReadOnly){throw 'UI Automation ValuePattern is read-only'};$p.SetValue(${q(value)});$method='ValuePattern'}catch{if($_.Exception.Message -like '*read-only*'){throw}}; if(-not $method){try{$p=$e.GetCurrentPattern([System.Windows.Automation.LegacyIAccessiblePattern]::Pattern);$p.SetValue(${q(value)});$method='LegacyIAccessiblePattern'}catch{}}; if(-not $method -and $e.Current.NativeWindowHandle -ne 0){if([Win32Windows]::SetControlText([IntPtr]$e.Current.NativeWindowHandle,${q(value)})){$method='WM_SETTEXT'}}; if(-not $method){$focus=[Win32Windows]::Focus([IntPtr]${int(hwnd)});if(-not $focus.focused){throw ('failed to focus hwnd ${int(hwnd)}; foreground hwnd is '+$focus.foreground_hwnd)};$e.SetFocus();Start-Sleep -Milliseconds 100;[System.Windows.Forms.SendKeys]::SendWait('^{A}');Start-Sleep -Milliseconds 100;[System.Windows.Forms.SendKeys]::SendWait(${q(sendKeysEscape(value))});$method='SetFocus+SendKeys'}; @{ hwnd=${int(hwnd)}; automation_id=$e.Current.AutomationId; name=$e.Current.Name; control_type=($e.Current.ControlType.ProgrammaticName -replace '^ControlType\\.'); set=$true; method=$method; value_chars=${value.length} } | ConvertTo-Json -Depth 5`;
}

function launchScript(filePath: string, args: string[], cwd?: string) {
  const argList = args.map(q).join(',');
  const cwdPart = cwd ? ` -WorkingDirectory ${q(cwd)}` : '';
  return `$p=Start-Process -FilePath ${q(filePath)} -ArgumentList @(${argList})${cwdPart} -PassThru; @{ pid=$p.Id; process_name=$p.ProcessName; file=${q(filePath)} } | ConvertTo-Json`;
}

function mouseClickScript(x: number, y: number, button: string) {
  return `${mouseTypes()}; [System.Windows.Forms.Cursor]::Position=New-Object System.Drawing.Point(${int(x)},${int(y)}); click ${q(button)}; @{ x=${int(x)}; y=${int(y)}; button=${q(button)} } | ConvertTo-Json`;
}

function mouseMoveScript(x: number, y: number) {
  return `${formsAssemblies()}; [System.Windows.Forms.Cursor]::Position=New-Object System.Drawing.Point(${int(x)},${int(y)}); @{ x=${int(x)}; y=${int(y)} } | ConvertTo-Json`;
}

function mouseDragScript(fromX: number, fromY: number, toX: number, toY: number, durationMs: number, steps: number) {
  return `${mouseTypes()}; $d=drag ${int(fromX)} ${int(fromY)} ${int(toX)} ${int(toY)} ${int(durationMs)} ${int(steps)}; @{ from=@{x=${int(fromX)};y=${int(fromY)}}; to=@{x=${int(toX)};y=${int(toY)}}; duration_ms=${int(durationMs)}; steps=${int(steps)}; actual_elapsed_ms=$d.actual_elapsed_ms } | ConvertTo-Json -Depth 4`;
}

function mouseScrollScript(x: number, y: number, delta: number) {
  return `${mouseTypes()}; [System.Windows.Forms.Cursor]::Position=New-Object System.Drawing.Point(${int(x)},${int(y)}); [Win32Input]::mouse_event(0x0800,0,0,${int(delta)},[UIntPtr]::Zero); @{ x=${int(x)}; y=${int(y)}; delta=${int(delta)} } | ConvertTo-Json`;
}

function windowClickScript(hwnd: number, x: number, y: number, button: string, coordinateSpace: string, focus: boolean) {
  return `${mouseTypes()}; ${win32WindowTypes()}; ${windowCoordinateTypes()}; ${windowInputFocusGuardFn()}; $focused=ensureWindowInputFocus ${int(hwnd)} ${psBool(focus)}; $p=windowPoint ${int(hwnd)} ${int(x)} ${int(y)} ${q(coordinateSpace)} $focused; [System.Windows.Forms.Cursor]::Position=New-Object System.Drawing.Point($p.screen.x,$p.screen.y); click ${q(button)}; $p | Add-Member -NotePropertyName button -NotePropertyValue ${q(button)} -PassThru | ConvertTo-Json -Depth 5`;
}

function windowMoveScript(hwnd: number, x: number, y: number, coordinateSpace: string, focus: boolean) {
  return `${formsAssemblies()}; ${win32WindowTypes()}; ${windowCoordinateTypes()}; ${windowInputFocusGuardFn()}; $focused=ensureWindowInputFocus ${int(hwnd)} ${psBool(focus)}; $p=windowPoint ${int(hwnd)} ${int(x)} ${int(y)} ${q(coordinateSpace)} $focused; [System.Windows.Forms.Cursor]::Position=New-Object System.Drawing.Point($p.screen.x,$p.screen.y); $p | ConvertTo-Json -Depth 5`;
}

function windowDragScript(hwnd: number, fromX: number, fromY: number, toX: number, toY: number, coordinateSpace: string, focus: boolean, durationMs: number, steps: number) {
  return `${mouseTypes()}; ${win32WindowTypes()}; ${windowCoordinateTypes()}; ${windowInputFocusGuardFn()}; $focused=ensureWindowInputFocus ${int(hwnd)} ${psBool(focus)}; $a=windowPoint ${int(hwnd)} ${int(fromX)} ${int(fromY)} ${q(coordinateSpace)} $focused; $b=windowPoint ${int(hwnd)} ${int(toX)} ${int(toY)} ${q(coordinateSpace)} $false; $d=drag $a.screen.x $a.screen.y $b.screen.x $b.screen.y ${int(durationMs)} ${int(steps)}; @{ hwnd=${int(hwnd)}; coordinate_space=${q(coordinateSpace)}; from=$a; to=$b; duration_ms=${int(durationMs)}; steps=${int(steps)}; actual_elapsed_ms=$d.actual_elapsed_ms } | ConvertTo-Json -Depth 6`;
}

function windowScrollScript(hwnd: number, x: number, y: number, delta: number, coordinateSpace: string, focus: boolean) {
  return `${mouseTypes()}; ${win32WindowTypes()}; ${windowCoordinateTypes()}; ${windowInputFocusGuardFn()}; $focused=ensureWindowInputFocus ${int(hwnd)} ${psBool(focus)}; $p=windowPoint ${int(hwnd)} ${int(x)} ${int(y)} ${q(coordinateSpace)} $focused; [System.Windows.Forms.Cursor]::Position=New-Object System.Drawing.Point($p.screen.x,$p.screen.y); [Win32Input]::mouse_event(0x0800,0,0,${int(delta)},[UIntPtr]::Zero); $p | Add-Member -NotePropertyName delta -NotePropertyValue ${int(delta)} -PassThru | ConvertTo-Json -Depth 5`;
}

function typeTextScript(text: string, hwnd?: number) {
  return `${targetedSendKeysPrefix(hwnd)}; [System.Windows.Forms.SendKeys]::SendWait(${q(sendKeysEscape(text))}); @{ typed_chars=${text.length}; hwnd=${psOptionalLiteral(hwnd)}; focused=$focused } | ConvertTo-Json`;
}

function sendKeysScript(keys: string, hwnd?: number) {
  return `${targetedSendKeysPrefix(hwnd)}; [System.Windows.Forms.SendKeys]::SendWait(${q(keys)}); @{ keys=${q(keys)}; hwnd=${psOptionalLiteral(hwnd)}; focused=$focused } | ConvertTo-Json`;
}

function clipboardGetScript() {
  return `${formsAssemblies()}; @{ text=[System.Windows.Forms.Clipboard]::GetText(); contains_text=[System.Windows.Forms.Clipboard]::ContainsText() } | ConvertTo-Json`;
}

function clipboardSetScript(text: string) {
  return `${formsAssemblies()}; [System.Windows.Forms.Clipboard]::SetText(${q(text)}); @{ set_text_chars=${text.length} } | ConvertTo-Json`;
}

function formsAssemblies() {
  return 'Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing';
}

function uiaAssemblies() {
  return 'Add-Type -AssemblyName UIAutomationClient; Add-Type -AssemblyName UIAutomationTypes';
}

function rectObjFn() {
  return 'function rectObj($r){ @{ x=[int]$r.X; y=[int]$r.Y; width=[int]$r.Width; height=[int]$r.Height } }';
}

function uiaRectObjFn() {
  return `function uiaFinite($v){ $d=[double]$v; (-not [double]::IsNaN($d)) -and (-not [double]::IsInfinity($d)) }; function uiaRectObj($r){ $finite=(uiaFinite $r.X) -and (uiaFinite $r.Y) -and (uiaFinite $r.Width) -and (uiaFinite $r.Height); $empty=$false; try{$empty=[bool]$r.IsEmpty}catch{}; if($finite -and (($r.Width -le 0) -or ($r.Height -le 0))){$empty=$true}; $bounds=$null; if($finite -and -not $empty){$bounds=@{ x=$r.X; y=$r.Y; width=$r.Width; height=$r.Height }}; @{ bounds=$bounds; bounds_finite=[bool]$finite; bounds_empty=[bool]$empty } }`;
}

function screenObjFn() {
  return `${rectObjFn()}; function screenObj($s){ @{ device_name=$s.DeviceName; primary=$s.Primary; bounds=rectObj $s.Bounds; working_area=rectObj $s.WorkingArea } }`;
}

function screenshotArtifactDir(workspace: Workspace) {
  return agentPath(workspace, 'artifacts', 'windows-screenshots');
}

function screenshotPaths(workspace: Workspace) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = screenshotArtifactDir(workspace);
  return { full: path.join(dir, `${SCREENSHOT_PREFIX}${stamp}.png`), preview: path.join(dir, `${SCREENSHOT_PREFIX}${stamp}-preview.webp`) };
}

function screenshotSequenceFramePaths(workspace: Workspace, stamp: string, frame: number) {
  const label = `frame-${String(frame).padStart(2, '0')}`;
  const dir = screenshotArtifactDir(workspace);
  return {
    full: path.join(dir, `${SCREENSHOT_SEQUENCE_PREFIX}${stamp}-${label}.png`),
    preview: path.join(dir, `${SCREENSHOT_SEQUENCE_PREFIX}${stamp}-${label}-preview.webp`)
  };
}

function sequenceArtifactResponse(pair: ReturnType<typeof artifactPair>) {
  const compact = (value: Record<string, unknown>) => ({ kind: value.kind, format: value.format, path: value.path, agent_artifact_path: value.agent_artifact_path });
  return { default: 'preview', preview: compact(pair.preview), full: compact(pair.full) };
}

async function writePreview(full: string, preview: string) {
  await sharp(full).resize({ width: 1280, withoutEnlargement: true }).webp({ quality: 85 }).toFile(preview);
  return preview;
}

function artifactPair(workspace: Workspace, full: string, preview: string) {
  return { full: artifact(workspace, full, 'png'), preview: artifact(workspace, preview, 'webp'), default: 'preview' };
}

function artifact(workspace: Workspace, absolute: string, format: string) {
  const agentPath = `.agent/${path.relative(workspace.realAgentDir, absolute).replaceAll(path.sep, '/')}`;
  const url = artifactUrl(workspace, agentPath);
  return { kind: 'image', format, agent_artifact_path: agentPath, path: agentPath, url_path: artifactUrlPath(workspace, agentPath), url, readable_url: url };
}

function artifactUrlPath(workspace: Workspace, agentPath: string) {
  return `/api/v1/artifacts/${encodeURIComponent(workspace.id)}/${encodeURIComponent(agentPath)}`;
}

function artifactUrl(workspace: Workspace, agentPath: string) {
  const base = (process.env.OTA_GATEWAY_PUBLIC_BASE_URL ?? '').replace(/\/$/, '');
  return base ? signedArtifactUrl(base, artifactUrlPath(workspace, agentPath)) : undefined;
}

async function delayStep(ms: number, index: number, started: number) {
  const delayMs = Math.min(Math.max(Math.trunc(ms), 0), 10000);
  await new Promise((resolve) => setTimeout(resolve, delayMs));
  return { index, kind: 'delay', delay_ms: delayMs, elapsed_ms: Date.now() - started };
}

function boundsFn() {
  return `function bounds($m){ $screens=[System.Windows.Forms.Screen]::AllScreens; if($m -eq 'all'){ return [System.Windows.Forms.SystemInformation]::VirtualScreen }; if($m -eq 'primary'){ return [System.Windows.Forms.Screen]::PrimaryScreen.Bounds }; $i=[int]$m; if($i -lt 0 -or $i -ge $screens.Count){ throw 'monitor index out of range' }; return $screens[$i].Bounds }`;
}

function captureFn() {
  return `function capture($b,$file){ $bmp=New-Object System.Drawing.Bitmap($b.Width,$b.Height); $g=[System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($b.X,$b.Y,0,0,$b.Size); $bmp.Save($file,[System.Drawing.Imaging.ImageFormat]::Png); $g.Dispose(); $bmp.Dispose() }`;
}

function windowCaptureTypes() {
  return `Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32Capture {
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdc, uint flags);
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
}
"@; function captureWindow($hwnd,$file){ $h=[IntPtr]$hwnd; if(-not [Win32Capture]::IsWindow($h)){throw 'hwnd is not a valid window'}; $r=New-Object Win32Capture+RECT; if(-not [Win32Capture]::GetWindowRect($h,[ref]$r)){throw 'GetWindowRect failed'}; $w=$r.Right-$r.Left; $hgt=$r.Bottom-$r.Top; if($w -le 0 -or $hgt -le 0){throw 'window has empty bounds'}; $bmp=New-Object System.Drawing.Bitmap($w,$hgt); $g=[System.Drawing.Graphics]::FromImage($bmp); $dc=$g.GetHdc(); try{$ok=[Win32Capture]::PrintWindow($h,$dc,2)}finally{$g.ReleaseHdc($dc)}; if(-not $ok){$g.CopyFromScreen($r.Left,$r.Top,0,0,$bmp.Size)}; $bmp.Save($file,[System.Drawing.Imaging.ImageFormat]::Png); $g.Dispose(); $bmp.Dispose(); @{ hwnd=$hwnd; bounds=@{x=$r.Left;y=$r.Top;width=$w;height=$hgt}; capture_method=$(if($ok){'print_window'}else{'screen_fallback'}); captured_at=(Get-Date).ToUniversalTime().ToString('o'); path=$file } }`;
}

function windowPlacementTypes() {
  return `Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32Placement {
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int command);
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr hWnd, int x, int y, int width, int height, bool repaint);
  public static bool Place(IntPtr hWnd, int x, int y, int width, int height) { if(!IsWindow(hWnd)) throw new Exception("hwnd is not a valid window"); ShowWindowAsync(hWnd, 9); return MoveWindow(hWnd, x, y, width, height, true); }
}
"@`;
}

function resolveMonitorFn() {
  return `function resolveMonitor($m){ $screens=[System.Windows.Forms.Screen]::AllScreens; if($m -eq 'primary'){return [System.Windows.Forms.Screen]::PrimaryScreen}; $i=[int]$m; if($i -lt 0 -or $i -ge $screens.Count){throw 'monitor index out of range'}; return $screens[$i] }`;
}

function win32WindowTypes() {
  return `Add-Type @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;
public class Win32Windows {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int command);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint first, uint second, bool attach);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr hWnd, uint message, IntPtr wParam, string lParam);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  public static object Focus(IntPtr hWnd) {
    if(!IsWindow(hWnd)) throw new Exception("hwnd is not a valid window");
    bool restored=IsIconic(hWnd); if(restored) ShowWindowAsync(hWnd,9);
    uint pid; uint targetThread=GetWindowThreadProcessId(hWnd,out pid); uint currentThread=GetCurrentThreadId();
    IntPtr before=GetForegroundWindow(); uint foregroundPid; uint foregroundThread=GetWindowThreadProcessId(before,out foregroundPid);
    bool attachTarget=targetThread!=0 && targetThread!=currentThread && AttachThreadInput(currentThread,targetThread,true);
    bool attachForeground=foregroundThread!=0 && foregroundThread!=currentThread && foregroundThread!=targetThread && AttachThreadInput(currentThread,foregroundThread,true);
    int attempts=0; try { for(attempts=1; attempts<=3; attempts++){ BringWindowToTop(hWnd); SetForegroundWindow(hWnd); Thread.Sleep(100); if(GetForegroundWindow()==hWnd) break; } }
    finally { if(attachForeground) AttachThreadInput(currentThread,foregroundThread,false); if(attachTarget) AttachThreadInput(currentThread,targetThread,false); }
    IntPtr after=GetForegroundWindow(); return new { hwnd=hWnd.ToInt64(), focused=after==hWnd, foreground_hwnd=after.ToInt64(), previous_foreground_hwnd=before.ToInt64(), restored=restored, attempts=Math.Min(attempts,3) };
  }
  public static bool SetControlText(IntPtr hWnd, string value) { return IsWindow(hWnd) && SendMessage(hWnd,0x000C,IntPtr.Zero,value)!=IntPtr.Zero; }
  public static object[] List() {
    var items = new List<object>(); IntPtr foreground=GetForegroundWindow();
    EnumWindows((h,l) => { if(!IsWindowVisible(h)) return true; var sb=new StringBuilder(512); GetWindowText(h,sb,512); if(sb.Length==0) return true; uint pid; GetWindowThreadProcessId(h,out pid); RECT r; GetWindowRect(h,out r); string processName=""; try{processName=Process.GetProcessById((int)pid).ProcessName;}catch{} items.Add(new { hwnd=h.ToInt64(), title=sb.ToString(), pid=pid, process_name=processName, foreground=h==foreground, minimized=IsIconic(h), maximized=IsZoomed(h), bounds=new { x=r.Left, y=r.Top, width=r.Right-r.Left, height=r.Bottom-r.Top } }); return true; }, IntPtr.Zero);
    return items.ToArray();
  }
}
"@`;
}

function mouseTypes() {
  return `${formsAssemblies()}; Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32Input {
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, int data, UIntPtr extra);
}
"@; function click($b){ $down=0x0002; $up=0x0004; if($b -eq 'right'){ $down=0x0008; $up=0x0010 }; [Win32Input]::mouse_event($down,0,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 40; [Win32Input]::mouse_event($up,0,0,0,[UIntPtr]::Zero) }; function drag($x1,$y1,$x2,$y2,$duration,$steps){ $steps=[Math]::Max(1,[int]$steps); $duration=[Math]::Max(0,[int]$duration); $sw=[System.Diagnostics.Stopwatch]::StartNew(); [System.Windows.Forms.Cursor]::Position=New-Object System.Drawing.Point($x1,$y1); [Win32Input]::mouse_event(0x0002,0,0,0,[UIntPtr]::Zero); for($i=1;$i -le $steps;$i++){ $ratio=$i/[double]$steps; $x=[int][Math]::Round($x1+(($x2-$x1)*$ratio)); $y=[int][Math]::Round($y1+(($y2-$y1)*$ratio)); [System.Windows.Forms.Cursor]::Position=New-Object System.Drawing.Point($x,$y); $target=[int][Math]::Round(($duration*$i)/[double]$steps); $sleep=$target-[int]$sw.ElapsedMilliseconds; if($sleep -gt 0){ Start-Sleep -Milliseconds $sleep } }; [Win32Input]::mouse_event(0x0004,0,0,0,[UIntPtr]::Zero); $sw.Stop(); @{ actual_elapsed_ms=[int]$sw.ElapsedMilliseconds } }`;
}

function windowCoordinateTypes() {
  return `Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32WindowCoordinates {
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr hWnd, ref POINT point);
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  public struct POINT { public int X; public int Y; }
  public static object Point(IntPtr hWnd, int x, int y, string space, bool focused) {
    if (!IsWindow(hWnd)) throw new Exception("hwnd is not a valid window");
    if (IsIconic(hWnd)) throw new Exception("window is minimized");
    var p = new POINT { X = x, Y = y };

    if (space == "window") { RECT r; if (!GetWindowRect(hWnd, out r)) throw new Exception("GetWindowRect failed"); p.X = r.Left + x; p.Y = r.Top + y; }
    else if (space == "client") { if (!ClientToScreen(hWnd, ref p)) throw new Exception("ClientToScreen failed"); }
    else throw new Exception("coordinate_space must be client or window");
    return new { hwnd = hWnd.ToInt64(), coordinate_space = space, local = new { x = x, y = y }, screen = new { x = p.X, y = p.Y }, focused = focused };
  }
}
"@; function windowPoint($hwnd,$x,$y,$space,$focused){ [Win32WindowCoordinates]::Point([IntPtr]$hwnd,[int]$x,[int]$y,$space,[bool]$focused) }`;
}

function windowInputFocusGuardFn() {
  return `function ensureWindowInputFocus($hwnd,$focusRequested){ if(-not [bool]$focusRequested){ return $false }; $focus=[Win32Windows]::Focus([IntPtr]$hwnd); if((-not $focus.focused) -or ([long]$focus.foreground_hwnd -ne [long]$hwnd)){throw ('failed to focus hwnd '+$hwnd+'; foreground hwnd is '+$focus.foreground_hwnd)}; return $true }`;
}

function uiaWalkFn() {
  return `${uiaRectObjFn()}; function nodeObj($e,$d,$r){ $ct=$e.Current.ControlType.ProgrammaticName -replace '^ControlType\\.'; $b=uiaRectObj $e.Current.BoundingRectangle; @{ ref=$r; depth=$d; name=$e.Current.Name; automation_id=$e.Current.AutomationId; class_name=$e.Current.ClassName; control_type=$ct; hwnd=$e.Current.NativeWindowHandle; pid=$e.Current.ProcessId; bounds=$b.bounds; bounds_finite=$b.bounds_finite; bounds_empty=$b.bounds_empty; enabled=$e.Current.IsEnabled; offscreen=$e.Current.IsOffscreen } }; function walk($e,$d,$max,$out){ if($out.Count -ge $max){ return }; $ref="n"+$out.Count; try{$node=nodeObj $e $d $ref}catch{$message=$_.Exception.Message; if($message.Length -gt 512){$message=$message.Substring(0,512)}; $node=@{ ref=$ref; depth=$d; fault=$message }}; [void]$out.Add($node); $w=[System.Windows.Automation.TreeWalker]::ControlViewWalker; try{$c=$w.GetFirstChild($e)}catch{return}; while($c -ne $null -and $out.Count -lt $max){ walk $c ($d+1) $max $out; try{$c=$w.GetNextSibling($c)}catch{$c=$null} } }`;
}

function uiaSelectorFn() {
  return `function findUiaElements($hwnd,$automationId,$name,$controlType){ $root=[System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$hwnd); if($root -eq $null){throw 'UI Automation root not found for hwnd'}; $all=$root.FindAll([System.Windows.Automation.TreeScope]::Subtree,[System.Windows.Automation.Condition]::TrueCondition); $matches=New-Object System.Collections.ArrayList; foreach($e in $all){ try{$ct=$e.Current.ControlType.ProgrammaticName -replace '^ControlType\\.'; if($automationId -and $e.Current.AutomationId -ne $automationId){continue}; if($name -and $e.Current.Name -ne $name){continue}; if($controlType -and $ct -ne $controlType){continue}; [void]$matches.Add($e)}catch{continue} }; return ,$matches }; function findUiaElement($hwnd,$automationId,$name,$controlType){ $matches=findUiaElements $hwnd $automationId $name $controlType; if($matches.Count -eq 0){throw 'UI Automation element not found for selector'}; return $matches[0] }`;
}

function targetedSendKeysPrefix(hwnd?: number) {
  if (hwnd === undefined) return `${formsAssemblies()}; $focused=$true`;
  return `${formsAssemblies()}; ${win32WindowTypes()}; $focus=[Win32Windows]::Focus([IntPtr]${int(hwnd)}); if(-not $focus.focused){throw ('failed to focus hwnd ${int(hwnd)}; foreground hwnd is '+$focus.foreground_hwnd)}; $focused=$true`;
}

function hotkeySequence(keys: string[]) {
  const names = keys.map((key) => key.toLowerCase());
  const modifiers = [['ctrl', '^'], ['control', '^'], ['alt', '%'], ['shift', '+']];
  const prefix = modifiers.filter(([name]) => names.includes(name)).map(([, code]) => code).join('');
  const normal = keys.find((key) => !modifiers.some(([name]) => key.toLowerCase() === name));
  return `${prefix}${normal ? `{${normal.toUpperCase()}}` : ''}`;
}

function sendKeysEscape(text: string) {
  return text.replace(/[+^%~(){}\[\]]/g, '{$&}').replace(/\n/g, '{ENTER}');
}

function q(value: unknown) {
  return `'${String(value ?? '').replaceAll("'", "''")}'`;
}

function int(value: number) {
  return Math.trunc(Number(value) || 0);
}

function num(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error('numeric argument required');
  return number;
}

function optionalNum(value: unknown) {
  return value === undefined || value === null ? undefined : num(value);
}

function finiteNumber(value: unknown, name: string) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${name} must be a finite number`);
  return number;
}

function integer(value: unknown, name: string) {
  const number = finiteNumber(value, name);
  if (!Number.isInteger(number)) throw new Error(`${name} must be an integer`);
  return number;
}

function boundedInteger(value: unknown, name: string, min: number, max: number) {
  const number = integer(value, name);
  if (number < min || number > max) throw new Error(`${name} must be between ${min} and ${max}`);
  return number;
}

function optionalHwnd(workspace: Workspace, value?: number) {
  if (value === undefined) return undefined;
  ensureCapability(workspace, 'allow_window_management');
  return integer(value, 'hwnd');
}

function optionalSize(width?: number, height?: number) {
  const parsedWidth = width === undefined ? undefined : finiteNumber(width, 'width');
  const parsedHeight = height === undefined ? undefined : finiteNumber(height, 'height');
  if (parsedWidth !== undefined && parsedWidth <= 0) throw new Error('width must be positive');
  if (parsedHeight !== undefined && parsedHeight <= 0) throw new Error('height must be positive');
  return { width: parsedWidth, height: parsedHeight };
}

function dragTiming(durationMs?: number, steps?: number) {
  const duration = durationMs === undefined ? 160 : boundedInteger(durationMs, 'duration_ms', 0, 10000);
  const stepCount = steps === undefined ? 8 : boundedInteger(steps, 'steps', 1, 200);
  return { duration_ms: duration, steps: stepCount };
}

function normalizeUiaSelector(selector: WindowsUiaSelector): Required<WindowsUiaSelector> {
  const normalized = {
    automation_id: String(selector.automation_id ?? '').trim(),
    name: String(selector.name ?? '').trim(),
    control_type: String(selector.control_type ?? '').replace(/^ControlType\./, '').trim()
  };
  if (!normalized.automation_id && !normalized.name && !normalized.control_type) throw new Error('UI Automation selector requires automation_id, name, or control_type');
  return normalized;
}

function screenPoint(x: unknown, y: unknown, prefix = '') {
  const label = prefix ? `${prefix}_` : '';
  return { x: finiteNumber(x, `${label}x`), y: finiteNumber(y, `${label}y`) };
}

function buttonName(value: unknown) {
  const button = String(value ?? 'left').toLowerCase();
  if (!['left', 'right'].includes(button)) throw new Error('button must be left or right');
  return button;
}

function coordinateSpaceName(value: unknown) {
  const name = String(value ?? 'client').toLowerCase();
  if (!['client', 'window'].includes(name)) throw new Error('coordinate_space must be client or window');
  return name;
}

function bool(value: unknown, fallback: boolean) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'string') return value.toLowerCase() !== 'false';
  return Boolean(value);
}

function psBool(value: boolean) {
  return value ? '$true' : '$false';
}

function psOptionalLiteral(value?: number) {
  return value === undefined ? '$null' : String(int(value));
}

function psOptionalNumber(value: number | undefined, fallback: string) {
  return value === undefined ? fallback : String(int(value));
}

function str(value: unknown, fallback = '') {
  return value === undefined || value === null ? fallback : String(value);
}

function arr(value: unknown) {
  if (!Array.isArray(value)) throw new Error('array argument required');
  return value.map(String);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
