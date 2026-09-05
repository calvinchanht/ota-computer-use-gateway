import { z } from 'zod';
import { runWorkspaceTool } from '../../core/toolRunner.js';
import { computerScreenClick, computerScreenDrag, computerScreenMouseMove, computerScreenScroll, computerWindowClick, computerWindowDrag, computerWindowMouseMove, computerWindowScroll, cuaDriverBatch, cuaDriverCall, cuaDriverStatus } from '../../tools/computer.js';
import {
  windowsBatch,
  windowsClick,
  windowsClipboardGet,
  windowsClipboardSet,
  windowsComputerStatus,
  windowsDoubleClick,
  windowsDrag,
  windowsFocusWindow,
  windowsHotkey,
  windowsKey,
  windowsLaunchApp,
  windowsListMonitors,
  windowsListWindows,
  windowsMouseMove,
  windowsPlaceWindow,
  windowsScreenshot,
  windowsScroll,
  windowsTypeText,
  windowsUiaRead,
  windowsUiaSetValue,
  windowsUiaTree,
  windowsWindowClick,
  windowsWindowDoubleClick,
  windowsWindowDrag,
  windowsWindowMouseMove,
  windowsWindowScreenshot,
  windowsWindowScreenshotSequence,
  windowsWindowScroll
} from '../../tools/windowsComputer.js';
import { windowsObserveNativeEvents } from '../../tools/windowsNativeObserver.js';
import { READ_ONLY, RUN_LOCAL, TOOL_RESULT_OUTPUT_SCHEMA } from './annotations.js';
import type { RegisterContext } from './types.js';

const cuaBatchStepSchema = z.union([
  z.object({ method: z.string().min(1).max(80), params: z.record(z.string(), z.unknown()).default({}) }),
  z.object({ delay_ms: z.number().int().min(0).max(5000) })
]);
const finiteNumberSchema = z.number().refine(Number.isFinite, 'must be finite');
const mouseButtonSchema = z.enum(['left', 'right']).default('left');
const coordinateSpaceSchema = z.enum(['client', 'window']).default('client');
const uiaSelectorFields = {
  automation_id: z.string().optional(),
  name: z.string().optional(),
  control_type: z.string().optional()
};
const visualFollowupSchema = z.object({
  job_id: z.string().optional(),
  agent_id: z.string().optional(),
  conversation_lane: z.string().min(1).optional(),
  idempotency_key: z.string().optional(),
  source: z.string().optional(),
  mime: z.string().optional(),
  prompt_text: z.string().optional()
}).optional();

export function registerComputerTools(context: RegisterContext): void {
  registerCuaDriverStatus(context);
  registerCuaDriverCall(context);
  registerComputerScreenClick(context);
  registerComputerWindowClick(context);
  registerComputerScreenMouseMove(context);
  registerComputerWindowMouseMove(context);
  registerComputerScreenDrag(context);
  registerComputerWindowDrag(context);
  registerComputerScreenScroll(context);
  registerComputerWindowScroll(context);
  registerCuaDriverBatch(context);
  registerWindowsTools(context);
}

function registerCuaDriverStatus({ server, workspaces }: RegisterContext): void {
  server.registerTool('cua_driver_status', {
    title: 'Cua Driver status',
    description: 'Return Cua Driver availability, permissions, adapter path, allowed methods, and Mac computer-use posture for a workspace.',
    inputSchema: { workspace_id: z.string() },
    outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: READ_ONLY
  }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'cua_driver_status', cuaDriverStatus));
}

function registerCuaDriverCall({ server, workspaces }: RegisterContext): void {
  server.registerTool('cua_driver_call', {
    title: 'Cua Driver call',
    description: 'Call one raw Cua Driver command for Mac computer use. For method=screenshot, OTA can create either a job-bound visual-followup when job_id is supplied, or a direct-mode visible screenshot prompt when agent_id/workspace_id is available.',
    inputSchema: { workspace_id: z.string(), method: z.string().min(1).max(80), params: z.record(z.string(), z.unknown()).default({}) },
    outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: RUN_LOCAL
  }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'cua_driver_call', (workspace) => cuaDriverCall(workspace, args.method, args.params)));
}

function registerComputerScreenClick({ server, workspaces }: RegisterContext): void {
  server.registerTool('computer_screen_click', {
    title: 'Computer screen click',
    description: 'Click global Mac screen coordinates. The gateway infers the target process/window when native Cua requires a pid; use for screenshot-coordinate interactions.',
    inputSchema: { workspace_id: z.string(), x: z.number(), y: z.number(), button: z.string().default('left'), click_count: z.number().int().min(1).max(2).default(1) },
    outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: RUN_LOCAL
  }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'computer_screen_click', (workspace) => computerScreenClick(workspace, args.x, args.y, args.button, args.click_count)));
}

function registerComputerWindowClick({ server, workspaces }: RegisterContext): void {
  server.registerTool('computer_window_click', {
    title: 'Computer window click',
    description: 'Click in a known Mac app/window/process context. Pass pid from list_windows or get_window_state; window_id is optional when available.',
    inputSchema: { workspace_id: z.string(), pid: z.number(), window_id: z.number().optional(), x: z.number(), y: z.number(), button: z.string().default('left'), click_count: z.number().int().min(1).max(2).default(1) },
    outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: RUN_LOCAL
  }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'computer_window_click', (workspace) => computerWindowClick(workspace, args.pid, args.x, args.y, args.window_id, args.button, args.click_count)));
}


function registerComputerScreenMouseMove({ server, workspaces }: RegisterContext): void {
  server.registerTool('computer_screen_mouse_move', {
    title: 'Computer screen mouse move',
    description: 'Move the visible Cua agent cursor overlay to global Mac screen coordinates. This is a hover/pointing helper; native app events are sent by click/drag/scroll tools.',
    inputSchema: { workspace_id: z.string(), x: z.number(), y: z.number() },
    outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: RUN_LOCAL
  }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'computer_screen_mouse_move', (workspace) => computerScreenMouseMove(workspace, args.x, args.y)));
}

function registerComputerWindowMouseMove({ server, workspaces }: RegisterContext): void {
  server.registerTool('computer_window_mouse_move', {
    title: 'Computer window mouse move',
    description: 'Move the visible Cua agent cursor overlay to window-local coordinates for a known Mac app/window/process. Pass pid from list_windows or get_window_state.',
    inputSchema: { workspace_id: z.string(), pid: z.number(), window_id: z.number().optional(), x: z.number(), y: z.number() },
    outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: RUN_LOCAL
  }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'computer_window_mouse_move', (workspace) => computerWindowMouseMove(workspace, args.pid, args.x, args.y, args.window_id)));
}

function registerComputerScreenDrag({ server, workspaces }: RegisterContext): void {
  server.registerTool('computer_screen_drag', {
    title: 'Computer screen drag',
    description: 'Drag between global Mac screen coordinates. The gateway infers the target process/window and translates to native Cua window-local coordinates.',
    inputSchema: { workspace_id: z.string(), from_x: z.number(), from_y: z.number(), to_x: z.number(), to_y: z.number(), button: z.string().default('left'), duration_ms: z.number().int().min(0).max(10000).optional(), steps: z.number().int().min(1).max(200).optional() },
    outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: RUN_LOCAL
  }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'computer_screen_drag', (workspace) => computerScreenDrag(workspace, args.from_x, args.from_y, args.to_x, args.to_y, args.button, args.duration_ms, args.steps)));
}

function registerComputerWindowDrag({ server, workspaces }: RegisterContext): void {
  server.registerTool('computer_window_drag', {
    title: 'Computer window drag',
    description: 'Drag in a known Mac app/window/process using window-local coordinates. Pass pid from list_windows or get_window_state; window_id is optional when available.',
    inputSchema: { workspace_id: z.string(), pid: z.number(), window_id: z.number().optional(), from_x: z.number(), from_y: z.number(), to_x: z.number(), to_y: z.number(), button: z.string().default('left'), duration_ms: z.number().int().min(0).max(10000).optional(), steps: z.number().int().min(1).max(200).optional() },
    outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: RUN_LOCAL
  }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'computer_window_drag', (workspace) => computerWindowDrag(workspace, args.pid, args.from_x, args.from_y, args.to_x, args.to_y, args.window_id, args.button, args.duration_ms, args.steps)));
}

function registerComputerScreenScroll({ server, workspaces }: RegisterContext): void {
  server.registerTool('computer_screen_scroll', {
    title: 'Computer screen scroll',
    description: 'Scroll the target Mac app/window inferred from global screen coordinates. Native Cua scroll uses the target pid focused region.',
    inputSchema: { workspace_id: z.string(), x: z.number(), y: z.number(), direction: z.enum(['up', 'down', 'left', 'right']), amount: z.number().int().min(1).max(50).default(3), by: z.enum(['line', 'page']).default('line') },
    outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: RUN_LOCAL
  }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'computer_screen_scroll', (workspace) => computerScreenScroll(workspace, args.x, args.y, args.direction, args.amount, args.by)));
}

function registerComputerWindowScroll({ server, workspaces }: RegisterContext): void {
  server.registerTool('computer_window_scroll', {
    title: 'Computer window scroll',
    description: 'Scroll a known Mac app/window/process by pid. Uses native Cua focused-region scrolling.',
    inputSchema: { workspace_id: z.string(), pid: z.number(), window_id: z.number().optional(), direction: z.enum(['up', 'down', 'left', 'right']), amount: z.number().int().min(1).max(50).default(3), by: z.enum(['line', 'page']).default('line') },
    outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: RUN_LOCAL
  }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'computer_window_scroll', (workspace) => computerWindowScroll(workspace, args.pid, args.direction, args.window_id, args.amount, args.by)));
}

function registerCuaDriverBatch({ server, workspaces }: RegisterContext): void {
  server.registerTool('cua_driver_batch', {
    title: 'Cua Driver batch',
    description: 'Send a sequence of raw Cua Driver commands for Mac computer use. Supports gateway-side { delay_ms } sequencing steps. This is transport sequencing around native Cua Driver calls, not a semantic computer-use wrapper.',
    inputSchema: { workspace_id: z.string(), calls: z.array(cuaBatchStepSchema).min(1).max(25) },
    outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: RUN_LOCAL
  }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'cua_driver_batch', (workspace) => cuaDriverBatch(workspace, args.calls)));
}

function registerWindowsTools({ server, workspaces }: RegisterContext): void {
  server.registerTool('windows_computer_status', { title: 'Windows computer status', description: 'Return Windows computer-use capability and adapter status.', inputSchema: { workspace_id: z.string() }, outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: READ_ONLY }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'windows_computer_status', windowsComputerStatus));
  server.registerTool('windows_list_monitors', { title: 'Windows list monitors', description: 'List Windows monitor bounds and primary flags.', inputSchema: { workspace_id: z.string() }, outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: READ_ONLY }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'windows_list_monitors', windowsListMonitors));
  server.registerTool('windows_screenshot', { title: 'Windows screenshot', description: 'Capture one monitor or all monitors and store screenshot artifacts. Direct visual delivery is lane-scoped: when no job_id is supplied, pass conversation_lane for the calling Threaddex lane.', inputSchema: { workspace_id: z.string(), monitor: z.string().default('primary'), conversation_lane: z.string().min(1).optional(), visual_followup: visualFollowupSchema, job_id: z.string().optional(), threaddex_job_id: z.string().optional() }, outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: RUN_LOCAL }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'windows_screenshot', (workspace) => windowsScreenshot(workspace, args.monitor, args)));
  server.registerTool('windows_window_screenshot', { title: 'Windows window screenshot', description: 'Capture one top-level hwnd without exposing competing image URLs. Direct visual delivery is scoped to conversation_lane when no job_id is supplied.', inputSchema: { workspace_id: z.string(), hwnd: z.number().int().finite(), conversation_lane: z.string().min(1).optional(), visual_followup: visualFollowupSchema, job_id: z.string().optional(), threaddex_job_id: z.string().optional() }, outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: RUN_LOCAL }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'windows_window_screenshot', (workspace) => windowsWindowScreenshot(workspace, args.hwnd, args)));
  server.registerTool('windows_window_screenshot_sequence', { title: 'Windows window screenshot sequence', description: 'Capture 2-8 ordered frames from one top-level hwnd and submit all previews to the calling Threaddex lane as one visual follow-up. The requested frame span is capped at 5 seconds.', inputSchema: { workspace_id: z.string(), hwnd: z.number().int().finite(), interval_ms: z.number().int().min(50).default(250), count: z.number().int().min(2).max(8).default(8), conversation_lane: z.string().min(1).optional(), visual_followup: visualFollowupSchema, job_id: z.string().optional(), threaddex_job_id: z.string().optional() }, outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: RUN_LOCAL }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'windows_window_screenshot_sequence', (workspace) => windowsWindowScreenshotSequence(workspace, args.hwnd, args.interval_ms, args.count, args)));
  server.registerTool('windows_uia_tree', { title: 'Windows UIA tree', description: 'Return a bounded Microsoft UI Automation tree snapshot. Supply hwnd to scope discovery to one top-level window.', inputSchema: { workspace_id: z.string(), hwnd: z.number().int().finite().optional(), max_nodes: z.number().int().min(1).max(1000).default(120) }, outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: READ_ONLY }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'windows_uia_tree', (workspace) => windowsUiaTree(workspace, args.max_nodes, args.hwnd)));
  server.registerTool('windows_uia_read', { title: 'Windows UIA read value', description: 'Read text/value from one UI Automation element by hwnd plus automation id, exact name, or control type. Tries ValuePattern, TextPattern DocumentRange, and legacy accessible value.', inputSchema: { workspace_id: z.string(), hwnd: z.number().int().finite(), ...uiaSelectorFields, max_chars: z.number().int().min(1).max(200000).default(20000) }, outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: READ_ONLY }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'windows_uia_read', (workspace) => windowsUiaRead(workspace, args.hwnd, args, args.max_chars)));
  server.registerTool('windows_uia_set_value', { title: 'Windows UIA set value', description: 'Set one writable UI Automation ValuePattern or legacy accessible value by hwnd plus automation id, exact name, or control type.', inputSchema: { workspace_id: z.string(), hwnd: z.number().int().finite(), ...uiaSelectorFields, value: z.string() }, outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: RUN_LOCAL }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'windows_uia_set_value', (workspace) => windowsUiaSetValue(workspace, args.hwnd, args, args.value)));
  server.registerTool('windows_list_windows', { title: 'Windows list windows', description: 'List visible top-level windows with hwnd, title, pid, process name, foreground/minimized/maximized state, and bounds. Use this before any hwnd-targeted action.', inputSchema: { workspace_id: z.string() }, outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: READ_ONLY }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'windows_list_windows', windowsListWindows));
  server.registerTool('windows_focus_window', { title: 'Windows focus window', description: 'Restore and deterministically focus a top-level hwnd with bounded retries, then report the actual foreground hwnd.', inputSchema: { workspace_id: z.string(), hwnd: z.number().int().finite() }, outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: RUN_LOCAL }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'windows_focus_window', (workspace) => windowsFocusWindow(workspace, args.hwnd)));
  server.registerTool('windows_place_window', { title: 'Windows place window', description: 'Restore, move, and size a top-level hwnd within the primary or indexed monitor working area, then focus it.', inputSchema: { workspace_id: z.string(), hwnd: z.number().int().finite(), monitor: z.string().default('primary'), x: finiteNumberSchema.default(0), y: finiteNumberSchema.default(0), width: finiteNumberSchema.optional(), height: finiteNumberSchema.optional() }, outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: RUN_LOCAL }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'windows_place_window', (workspace) => windowsPlaceWindow(workspace, args.hwnd, args.monitor, args.x, args.y, args.width, args.height)));
  server.registerTool('windows_launch_app', { title: 'Windows launch app', description: 'Launch a local Windows app or executable.', inputSchema: { workspace_id: z.string(), file_path: z.string(), args: z.array(z.string()).default([]), cwd: z.string().optional() }, outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: RUN_LOCAL }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'windows_launch_app', (workspace) => windowsLaunchApp(workspace, args.file_path, args.args, args.cwd)));
  server.registerTool('windows_observe_native_events', { title: 'Windows native event observer', description: 'Observe a fixed, bounded READ_ONLY stream of left/right WH_MOUSE_LL delivery plus approved WinEvent lifecycle records for an already-owned Roblox Studio PID/HWND.', inputSchema: { workspace_id: z.string(), pid: z.number().int().positive(), hwnd: z.number().int().positive() }, outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: READ_ONLY }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'windows_observe_native_events', (workspace) => windowsObserveNativeEvents(workspace, args.pid, args.hwnd)));
  registerWindowsInputTools(server, workspaces);
}

function registerWindowsInputTools(server: RegisterContext['server'], workspaces: RegisterContext['workspaces']): void {
  server.registerTool('windows_mouse_move', { title: 'Windows mouse move', description: 'Move the mouse to screen coordinates.', inputSchema: { workspace_id: z.string(), x: finiteNumberSchema, y: finiteNumberSchema }, outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: RUN_LOCAL }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'windows_mouse_move', (workspace) => windowsMouseMove(workspace, args.x, args.y)));
  server.registerTool('windows_click', { title: 'Windows click', description: 'Move the mouse and click at screen coordinates.', inputSchema: { workspace_id: z.string(), x: finiteNumberSchema, y: finiteNumberSchema, button: mouseButtonSchema }, outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: RUN_LOCAL }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'windows_click', (workspace) => windowsClick(workspace, args.x, args.y, args.button)));
  server.registerTool('windows_double_click', { title: 'Windows double click', description: 'Move the mouse and double click at screen coordinates.', inputSchema: { workspace_id: z.string(), x: finiteNumberSchema, y: finiteNumberSchema, button: mouseButtonSchema }, outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: RUN_LOCAL }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'windows_double_click', (workspace) => windowsDoubleClick(workspace, args.x, args.y, args.button)));
  server.registerTool('windows_drag', { title: 'Windows drag', description: 'Drag from one screen coordinate to another with optional controlled duration and interpolation steps.', inputSchema: { workspace_id: z.string(), from_x: finiteNumberSchema, from_y: finiteNumberSchema, to_x: finiteNumberSchema, to_y: finiteNumberSchema, duration_ms: z.number().int().min(0).max(10000).optional(), steps: z.number().int().min(1).max(200).optional() }, outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: RUN_LOCAL }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'windows_drag', (workspace) => windowsDrag(workspace, args.from_x, args.from_y, args.to_x, args.to_y, args.duration_ms, args.steps)));
  server.registerTool('windows_scroll', { title: 'Windows scroll', description: 'Scroll at screen coordinates.', inputSchema: { workspace_id: z.string(), x: finiteNumberSchema, y: finiteNumberSchema, delta: finiteNumberSchema }, outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: RUN_LOCAL }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'windows_scroll', (workspace) => windowsScroll(workspace, args.x, args.y, args.delta)));
  registerWindowsWindowInputTools(server, workspaces);
  server.registerTool('windows_type_text', { title: 'Windows type text', description: 'Type text into the active UI, or supply hwnd to focus and verify a specific top-level window before typing.', inputSchema: { workspace_id: z.string(), text: z.string(), hwnd: z.number().int().finite().optional() }, outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: RUN_LOCAL }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'windows_type_text', (workspace) => windowsTypeText(workspace, args.text, args.hwnd)));
  server.registerTool('windows_key', { title: 'Windows key', description: 'Send a Windows Forms SendKeys sequence, optionally to a focused and verified hwnd.', inputSchema: { workspace_id: z.string(), key: z.string(), hwnd: z.number().int().finite().optional() }, outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: RUN_LOCAL }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'windows_key', (workspace) => windowsKey(workspace, args.key, args.hwnd)));
  server.registerTool('windows_hotkey', { title: 'Windows hotkey', description: 'Send a modifier hotkey combination, optionally to a focused and verified hwnd.', inputSchema: { workspace_id: z.string(), keys: z.array(z.string()).min(1), hwnd: z.number().int().finite().optional() }, outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: RUN_LOCAL }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'windows_hotkey', (workspace) => windowsHotkey(workspace, args.keys, args.hwnd)));
  server.registerTool('windows_clipboard_get', { title: 'Windows clipboard get', description: 'Read Windows clipboard text.', inputSchema: { workspace_id: z.string() }, outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: READ_ONLY }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'windows_clipboard_get', windowsClipboardGet));
  server.registerTool('windows_clipboard_set', { title: 'Windows clipboard set', description: 'Set Windows clipboard text.', inputSchema: { workspace_id: z.string(), text: z.string() }, outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: RUN_LOCAL }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'windows_clipboard_set', (workspace) => windowsClipboardSet(workspace, args.text)));
  server.registerTool('windows_batch', { title: 'Windows computer batch', description: 'Run a sequence of Windows computer-use input actions and delay steps.', inputSchema: { workspace_id: z.string(), calls: z.array(windowsBatchStepSchema).min(1).max(50) }, outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: RUN_LOCAL }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'windows_batch', (workspace) => windowsBatch(workspace, args.calls as any)));
}

function registerWindowsWindowInputTools(server: RegisterContext['server'], workspaces: RegisterContext['workspaces']): void {
  const point = { workspace_id: z.string(), hwnd: z.number().int().finite(), x: finiteNumberSchema, y: finiteNumberSchema, coordinate_space: coordinateSpaceSchema, focus: z.boolean().default(true) };
  server.registerTool('windows_window_mouse_move', { title: 'Windows window mouse move', description: 'Move the mouse to window-local coordinates.', inputSchema: { ...point, focus: z.boolean().default(false) }, outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: RUN_LOCAL }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'windows_window_mouse_move', (workspace) => windowsWindowMouseMove(workspace, args.hwnd, args.x, args.y, args.coordinate_space, args.focus)));
  server.registerTool('windows_window_click', { title: 'Windows window click', description: 'Click at client/window-local coordinates for a top-level hwnd.', inputSchema: { ...point, button: mouseButtonSchema }, outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: RUN_LOCAL }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'windows_window_click', (workspace) => windowsWindowClick(workspace, args.hwnd, args.x, args.y, args.button, args.coordinate_space, args.focus)));
  server.registerTool('windows_window_double_click', { title: 'Windows window double click', description: 'Double click at client/window-local coordinates for a top-level hwnd.', inputSchema: { ...point, button: mouseButtonSchema }, outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: RUN_LOCAL }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'windows_window_double_click', (workspace) => windowsWindowDoubleClick(workspace, args.hwnd, args.x, args.y, args.button, args.coordinate_space, args.focus)));
  server.registerTool('windows_window_scroll', { title: 'Windows window scroll', description: 'Scroll at client/window-local coordinates for a top-level hwnd.', inputSchema: { ...point, delta: finiteNumberSchema }, outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: RUN_LOCAL }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'windows_window_scroll', (workspace) => windowsWindowScroll(workspace, args.hwnd, args.x, args.y, args.delta, args.coordinate_space, args.focus)));
  server.registerTool('windows_window_drag', { title: 'Windows window drag', description: 'Drag between client/window-local coordinates for a top-level hwnd.', inputSchema: windowDragSchema(), outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: RUN_LOCAL }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'windows_window_drag', (workspace) => windowsWindowDrag(workspace, args.hwnd, args.from_x, args.from_y, args.to_x, args.to_y, args.coordinate_space, args.focus, args.duration_ms, args.steps)));
}

function windowDragSchema() {
  return { workspace_id: z.string(), hwnd: z.number().int().finite(), from_x: finiteNumberSchema, from_y: finiteNumberSchema, to_x: finiteNumberSchema, to_y: finiteNumberSchema, coordinate_space: coordinateSpaceSchema, focus: z.boolean().default(true), duration_ms: z.number().int().min(0).max(10000).optional(), steps: z.number().int().min(1).max(200).optional() };
}

const windowsBatchStepSchema = z.union([
  z.object({ tool: z.string(), args: z.record(z.string(), z.unknown()).default({}) }),
  z.object({ delay_ms: z.number().int().min(0).max(10000) })
]);
