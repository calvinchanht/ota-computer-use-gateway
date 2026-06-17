import { execFile } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { promisify } from 'node:util';
import { ok } from '../core/result.js';
import { platformInfo } from '../core/platform.js';
import type { Workspace } from '../core/workspaces.js';
import { signedArtifactUrl } from '../server/artifactSignatures.js';

const execFileAsync = promisify(execFile);
const MAX_POWERSHELL_BUFFER = 8 * 1024 * 1024;
const MAX_BATCH_STEPS = 50;
const SCREENSHOT_PREFIX = 'windows-screenshot-';

export type WindowsBatchStep =
  | { tool: string; args?: Record<string, unknown> }
  | { delay_ms: number };

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

export async function windowsScreenshot(workspace: Workspace, monitor = 'primary') {
  ensureEnabled(workspace);
  ensureCapability(workspace, 'allow_screenshot');
  ensureMonitorAllowed(workspace, monitor);
  ensureWindows();
  const paths = screenshotPaths(workspace);
  await mkdir(path.dirname(paths.full), { recursive: true });
  const data = await psObject(screenshotScript(paths.full, monitor));
  const preview = await writePreview(paths.full, paths.preview);
  return ok('windows screenshot', { ...data, artifact: artifactPair(workspace, paths.full, preview) });
}

export async function windowsUiaTree(workspace: Workspace, maxNodes = 120) {
  ensureEnabled(workspace);
  ensureCapability(workspace, 'allow_uia_tree');
  const limit = boundedInteger(maxNodes, 'max_nodes', 1, 1000);
  ensureWindows();
  return ok('windows uia tree', await psJson(uiaTreeScript(limit)));
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

export async function windowsDrag(workspace: Workspace, fromX: number, fromY: number, toX: number, toY: number) {
  ensureEnabled(workspace);
  ensureCapability(workspace, 'allow_mouse');
  const from = screenPoint(fromX, fromY, 'from');
  const to = screenPoint(toX, toY, 'to');
  ensureWindows();
  return ok('windows drag', await psJson(mouseDragScript(from.x, from.y, to.x, to.y)));
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
  const second = await windowsWindowClick(workspace, hwnd, x, y, button, coordinateSpace, false);
  return ok('windows window double click', { first: first.data, second: second.data });
}

export async function windowsWindowMouseMove(workspace: Workspace, hwnd: number, x: number, y: number, coordinateSpace = 'client', focus = false) {
  ensureWindowMouse(workspace, hwnd, x, y, coordinateSpace);
  return ok('windows window mouse move', await psJson(windowMoveScript(integer(hwnd, 'hwnd'), finiteNumber(x, 'x'), finiteNumber(y, 'y'), coordinateSpaceName(coordinateSpace), Boolean(focus))));
}

export async function windowsWindowDrag(workspace: Workspace, hwnd: number, fromX: number, fromY: number, toX: number, toY: number, coordinateSpace = 'client', focus = true) {
  ensureWindowMouse(workspace, hwnd, fromX, fromY, coordinateSpace);
  const to = screenPoint(toX, toY, 'to');
  return ok('windows window drag', await psJson(windowDragScript(integer(hwnd, 'hwnd'), finiteNumber(fromX, 'from_x'), finiteNumber(fromY, 'from_y'), to.x, to.y, coordinateSpaceName(coordinateSpace), Boolean(focus))));
}

export async function windowsWindowScroll(workspace: Workspace, hwnd: number, x: number, y: number, delta: number, coordinateSpace = 'client', focus = true) {
  ensureWindowMouse(workspace, hwnd, x, y, coordinateSpace);
  const scrollDelta = finiteNumber(delta, 'delta');
  return ok('windows window scroll', await psJson(windowScrollScript(integer(hwnd, 'hwnd'), finiteNumber(x, 'x'), finiteNumber(y, 'y'), scrollDelta, coordinateSpaceName(coordinateSpace), Boolean(focus))));
}

export async function windowsTypeText(workspace: Workspace, text: string) {
  ensureEnabled(workspace);
  ensureCapability(workspace, 'allow_keyboard');
  ensureWindows();
  return ok('windows typed text', await psJson(typeTextScript(text)));
}

export async function windowsKey(workspace: Workspace, key: string) {
  ensureEnabled(workspace);
  ensureCapability(workspace, 'allow_keyboard');
  ensureWindows();
  return ok('windows key', await psJson(sendKeysScript(key)));
}

export async function windowsHotkey(workspace: Workspace, keys: string[]) {
  ensureEnabled(workspace);
  ensureCapability(workspace, 'allow_keyboard');
  ensureWindows();
  return ok('windows hotkey', await psJson(sendKeysScript(hotkeySequence(keys))));
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
  if (tool === 'drag') return windowsDrag(workspace, num(args.from_x), num(args.from_y), num(args.to_x), num(args.to_y));
  if (tool === 'scroll') return windowsScroll(workspace, num(args.x), num(args.y), num(args.delta));
  if (tool === 'window_click') return windowsWindowClick(workspace, num(args.hwnd), num(args.x), num(args.y), str(args.button, 'left'), str(args.coordinate_space, 'client'), bool(args.focus, true));
  if (tool === 'window_mouse_move') return windowsWindowMouseMove(workspace, num(args.hwnd), num(args.x), num(args.y), str(args.coordinate_space, 'client'), bool(args.focus, false));
  if (tool === 'window_drag') return windowsWindowDrag(workspace, num(args.hwnd), num(args.from_x), num(args.from_y), num(args.to_x), num(args.to_y), str(args.coordinate_space, 'client'), bool(args.focus, true));
  if (tool === 'window_scroll') return windowsWindowScroll(workspace, num(args.hwnd), num(args.x), num(args.y), num(args.delta), str(args.coordinate_space, 'client'), bool(args.focus, true));
  if (tool === 'type_text') return windowsTypeText(workspace, str(args.text));
  if (tool === 'key') return windowsKey(workspace, str(args.key));
  if (tool === 'hotkey') return windowsHotkey(workspace, arr(args.keys));
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

async function psJson(script: string): Promise<unknown> {
  const encoded = Buffer.from(`$ProgressPreference='SilentlyContinue'; ${script}`, 'utf16le').toString('base64');
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

function uiaTreeScript(maxNodes: number) {
  return `${uiaAssemblies()}; ${rectObjFn()}; ${uiaWalkFn()}; $root=[System.Windows.Automation.AutomationElement]::RootElement; $out=New-Object System.Collections.ArrayList; walk $root 0 ${Math.max(1, Math.trunc(maxNodes))} $out; @{ nodes=$out; count=$out.Count; truncated=($out.Count -ge ${Math.max(1, Math.trunc(maxNodes))}) } | ConvertTo-Json -Depth 8`;
}

function listWindowsScript() {
  return `${win32WindowTypes()}; [Win32Windows]::List() | ConvertTo-Json -Depth 5`;
}

function focusWindowScript(hwnd: number) {
  return `${win32WindowTypes()}; $ok=[Win32Windows]::Focus([IntPtr]${Math.trunc(hwnd)}); @{ hwnd=${Math.trunc(hwnd)}; focused=$ok } | ConvertTo-Json`;
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

function mouseDragScript(fromX: number, fromY: number, toX: number, toY: number) {
  return `${mouseTypes()}; drag ${int(fromX)} ${int(fromY)} ${int(toX)} ${int(toY)}; @{ from=@{x=${int(fromX)};y=${int(fromY)}}; to=@{x=${int(toX)};y=${int(toY)}} } | ConvertTo-Json -Depth 4`;
}

function mouseScrollScript(x: number, y: number, delta: number) {
  return `${mouseTypes()}; [System.Windows.Forms.Cursor]::Position=New-Object System.Drawing.Point(${int(x)},${int(y)}); [Win32Input]::mouse_event(0x0800,0,0,${int(delta)},[UIntPtr]::Zero); @{ x=${int(x)}; y=${int(y)}; delta=${int(delta)} } | ConvertTo-Json`;
}

function windowClickScript(hwnd: number, x: number, y: number, button: string, coordinateSpace: string, focus: boolean) {
  return `${mouseTypes()}; ${windowCoordinateTypes()}; $p=windowPoint ${int(hwnd)} ${int(x)} ${int(y)} ${q(coordinateSpace)} ${psBool(focus)}; [System.Windows.Forms.Cursor]::Position=New-Object System.Drawing.Point($p.screen.x,$p.screen.y); click ${q(button)}; $p | Add-Member -NotePropertyName button -NotePropertyValue ${q(button)} -PassThru | ConvertTo-Json -Depth 5`;
}

function windowMoveScript(hwnd: number, x: number, y: number, coordinateSpace: string, focus: boolean) {
  return `${formsAssemblies()}; ${windowCoordinateTypes()}; $p=windowPoint ${int(hwnd)} ${int(x)} ${int(y)} ${q(coordinateSpace)} ${psBool(focus)}; [System.Windows.Forms.Cursor]::Position=New-Object System.Drawing.Point($p.screen.x,$p.screen.y); $p | ConvertTo-Json -Depth 5`;
}

function windowDragScript(hwnd: number, fromX: number, fromY: number, toX: number, toY: number, coordinateSpace: string, focus: boolean) {
  return `${mouseTypes()}; ${windowCoordinateTypes()}; $a=windowPoint ${int(hwnd)} ${int(fromX)} ${int(fromY)} ${q(coordinateSpace)} ${psBool(focus)}; $b=windowPoint ${int(hwnd)} ${int(toX)} ${int(toY)} ${q(coordinateSpace)} $false; drag $a.screen.x $a.screen.y $b.screen.x $b.screen.y; @{ hwnd=${int(hwnd)}; coordinate_space=${q(coordinateSpace)}; from=$a; to=$b } | ConvertTo-Json -Depth 6`;
}

function windowScrollScript(hwnd: number, x: number, y: number, delta: number, coordinateSpace: string, focus: boolean) {
  return `${mouseTypes()}; ${windowCoordinateTypes()}; $p=windowPoint ${int(hwnd)} ${int(x)} ${int(y)} ${q(coordinateSpace)} ${psBool(focus)}; [System.Windows.Forms.Cursor]::Position=New-Object System.Drawing.Point($p.screen.x,$p.screen.y); [Win32Input]::mouse_event(0x0800,0,0,${int(delta)},[UIntPtr]::Zero); $p | Add-Member -NotePropertyName delta -NotePropertyValue ${int(delta)} -PassThru | ConvertTo-Json -Depth 5`;
}

function typeTextScript(text: string) {
  return `${formsAssemblies()}; [System.Windows.Forms.SendKeys]::SendWait(${q(sendKeysEscape(text))}); @{ typed_chars=${text.length} } | ConvertTo-Json`;
}

function sendKeysScript(keys: string) {
  return `${formsAssemblies()}; [System.Windows.Forms.SendKeys]::SendWait(${q(keys)}); @{ keys=${q(keys)} } | ConvertTo-Json`;
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

function screenObjFn() {
  return `${rectObjFn()}; function screenObj($s){ @{ device_name=$s.DeviceName; primary=$s.Primary; bounds=rectObj $s.Bounds; working_area=rectObj $s.WorkingArea } }`;
}

function screenshotArtifactDir(workspace: Workspace) {
  return path.join(workspace.realAgentDir, 'artifacts', 'windows-screenshots');
}

function screenshotPaths(workspace: Workspace) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = screenshotArtifactDir(workspace);
  return { full: path.join(dir, `${SCREENSHOT_PREFIX}${stamp}.png`), preview: path.join(dir, `${SCREENSHOT_PREFIX}${stamp}-preview.webp`) };
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

function win32WindowTypes() {
  return `Add-Type @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class Win32Windows {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  public static bool Focus(IntPtr hWnd) { return SetForegroundWindow(hWnd); }
  public static object[] List() {
    var items = new List<object>();
    EnumWindows((h,l) => { if(!IsWindowVisible(h)) return true; var sb=new StringBuilder(512); GetWindowText(h,sb,512); if(sb.Length==0) return true; uint pid; GetWindowThreadProcessId(h,out pid); RECT r; GetWindowRect(h,out r); items.Add(new { hwnd=h.ToInt64(), title=sb.ToString(), pid=pid, bounds=new { x=r.Left, y=r.Top, width=r.Right-r.Left, height=r.Bottom-r.Top } }); return true; }, IntPtr.Zero);
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
"@; function click($b){ $down=0x0002; $up=0x0004; if($b -eq 'right'){ $down=0x0008; $up=0x0010 }; [Win32Input]::mouse_event($down,0,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 40; [Win32Input]::mouse_event($up,0,0,0,[UIntPtr]::Zero) }; function drag($x1,$y1,$x2,$y2){ [System.Windows.Forms.Cursor]::Position=New-Object System.Drawing.Point($x1,$y1); [Win32Input]::mouse_event(0x0002,0,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 80; [System.Windows.Forms.Cursor]::Position=New-Object System.Drawing.Point($x2,$y2); Start-Sleep -Milliseconds 80; [Win32Input]::mouse_event(0x0004,0,0,0,[UIntPtr]::Zero) }`;
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
  public static object Point(IntPtr hWnd, int x, int y, string space, bool focus) {
    if (!IsWindow(hWnd)) throw new Exception("hwnd is not a valid window");
    if (IsIconic(hWnd)) throw new Exception("window is minimized");
    var p = new POINT { X = x, Y = y };
    bool focused = focus && SetForegroundWindow(hWnd);
    if (space == "window") { RECT r; if (!GetWindowRect(hWnd, out r)) throw new Exception("GetWindowRect failed"); p.X = r.Left + x; p.Y = r.Top + y; }
    else if (space == "client") { if (!ClientToScreen(hWnd, ref p)) throw new Exception("ClientToScreen failed"); }
    else throw new Exception("coordinate_space must be client or window");
    return new { hwnd = hWnd.ToInt64(), coordinate_space = space, local = new { x = x, y = y }, screen = new { x = p.X, y = p.Y }, focused = focused };
  }
}
"@; function windowPoint($hwnd,$x,$y,$space,$focus){ [Win32WindowCoordinates]::Point([IntPtr]$hwnd,[int]$x,[int]$y,$space,[bool]$focus) }`;
}

function uiaWalkFn() {
  return `${rectObjFn()}; function nodeObj($e,$d,$r){ $ct=$e.Current.ControlType.ProgrammaticName -replace '^ControlType\\.'; @{ ref=$r; depth=$d; name=$e.Current.Name; automation_id=$e.Current.AutomationId; class_name=$e.Current.ClassName; control_type=$ct; hwnd=$e.Current.NativeWindowHandle; pid=$e.Current.ProcessId; bounds=rectObj $e.Current.BoundingRectangle; enabled=$e.Current.IsEnabled; offscreen=$e.Current.IsOffscreen } }; function walk($e,$d,$max,$out){ if($out.Count -ge $max){ return }; [void]$out.Add((nodeObj $e $d ("n"+$out.Count))); $w=[System.Windows.Automation.TreeWalker]::ControlViewWalker; $c=$w.GetFirstChild($e); while($c -ne $null -and $out.Count -lt $max){ walk $c ($d+1) $max $out; $c=$w.GetNextSibling($c) } }`;
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
