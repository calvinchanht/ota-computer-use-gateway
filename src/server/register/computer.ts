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
  windowsScreenshot,
  windowsScroll,
  windowsTypeText,
  windowsUiaTree,
  windowsWindowClick,
  windowsWindowDoubleClick,
  windowsWindowDrag,
  windowsWindowMouseMove,
  windowsWindowScroll
} from '../../tools/windowsComputer.js';
import { READ_ONLY, RUN_LOCAL, TOOL_RESULT_OUTPUT_SCHEMA } from './annotations.js';
import type { RegisterContext } from './types.js';

const cuaBatchStepSchema = z.union([
  z.object({ method: z.string().min(1).max(80), params: z.record(z.string(), z.unknown()).default({}) }),
  z.object({ delay_ms: z.number().int().min(0).max(5000) })
]);
const finiteNumberSchema = z.number().refine(Number.isFinite, 'must be finite');
const mouseButtonSchema = z.enum(['left', 'right']).default('left');
const coordinateSpaceSchema = z.enum(['client', 'window']).default('client');

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
    description: 'Call one raw Cua Driver command for Mac computer use. For method=screenshot, optional params.visual_followup.job_id asks OTA to create a Threaddex visual-followup event and return a pollable sent_to_provider contract.',
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
  server.registerTool('windows_screenshot', { title: 'Windows screenshot', description: 'Capture one monitor or all monitors and store screenshot artifacts.', inputSchema: { workspace_id: z.string(), monitor: z.string().default('primary') }, outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: RUN_LOCAL }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'windows_screenshot', (workspace) => windowsScreenshot(workspace, args.monitor)));
  server.registerTool('windows_uia_tree', { title: 'Windows UIA tree', description: 'Return a bounded Microsoft UI Automation tree snapshot.', inputSchema: { workspace_id: z.string(), max_nodes: z.number().int().min(1).max(1000).default(120) }, outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: READ_ONLY }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'windows_uia_tree', (workspace) => windowsUiaTree(workspace, args.max_nodes)));
  server.registerTool('windows_list_windows', { title: 'Windows list windows', description: 'List visible top-level Windows desktop windows.', inputSchema: { workspace_id: z.string() }, outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: READ_ONLY }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'windows_list_windows', windowsListWindows));
  server.registerTool('windows_focus_window', { title: 'Windows focus window', description: 'Focus a top-level window by hwnd.', inputSchema: { workspace_id: z.string(), hwnd: z.number().int().finite() }, outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: RUN_LOCAL }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'windows_focus_window', (workspace) => windowsFocusWindow(workspace, args.hwnd)));
  server.registerTool('windows_launch_app', { title: 'Windows launch app', description: 'Launch a local Windows app or executable.', inputSchema: { workspace_id: z.string(), file_path: z.string(), args: z.array(z.string()).default([]), cwd: z.string().optional() }, outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: RUN_LOCAL }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'windows_launch_app', (workspace) => windowsLaunchApp(workspace, args.file_path, args.args, args.cwd)));
  registerWindowsInputTools(server, workspaces);
}

function registerWindowsInputTools(server: RegisterContext['server'], workspaces: RegisterContext['workspaces']): void {
  server.registerTool('windows_mouse_move', { title: 'Windows mouse move', description: 'Move the mouse to screen coordinates.', inputSchema: { workspace_id: z.string(), x: finiteNumberSchema, y: finiteNumberSchema }, outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: RUN_LOCAL }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'windows_mouse_move', (workspace) => windowsMouseMove(workspace, args.x, args.y)));
  server.registerTool('windows_click', { title: 'Windows click', description: 'Move the mouse and click at screen coordinates.', inputSchema: { workspace_id: z.string(), x: finiteNumberSchema, y: finiteNumberSchema, button: mouseButtonSchema }, outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: RUN_LOCAL }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'windows_click', (workspace) => windowsClick(workspace, args.x, args.y, args.button)));
  server.registerTool('windows_double_click', { title: 'Windows double click', description: 'Move the mouse and double click at screen coordinates.', inputSchema: { workspace_id: z.string(), x: finiteNumberSchema, y: finiteNumberSchema, button: mouseButtonSchema }, outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: RUN_LOCAL }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'windows_double_click', (workspace) => windowsDoubleClick(workspace, args.x, args.y, args.button)));
  server.registerTool('windows_drag', { title: 'Windows drag', description: 'Drag from one screen coordinate to another.', inputSchema: { workspace_id: z.string(), from_x: finiteNumberSchema, from_y: finiteNumberSchema, to_x: finiteNumberSchema, to_y: finiteNumberSchema }, outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: RUN_LOCAL }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'windows_drag', (workspace) => windowsDrag(workspace, args.from_x, args.from_y, args.to_x, args.to_y)));
  server.registerTool('windows_scroll', { title: 'Windows scroll', description: 'Scroll at screen coordinates.', inputSchema: { workspace_id: z.string(), x: finiteNumberSchema, y: finiteNumberSchema, delta: finiteNumberSchema }, outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: RUN_LOCAL }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'windows_scroll', (workspace) => windowsScroll(workspace, args.x, args.y, args.delta)));
  registerWindowsWindowInputTools(server, workspaces);
  server.registerTool('windows_type_text', { title: 'Windows type text', description: 'Type text into the active Windows UI.', inputSchema: { workspace_id: z.string(), text: z.string() }, outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: RUN_LOCAL }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'windows_type_text', (workspace) => windowsTypeText(workspace, args.text)));
  server.registerTool('windows_key', { title: 'Windows key', description: 'Send a Windows Forms SendKeys key sequence.', inputSchema: { workspace_id: z.string(), key: z.string() }, outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: RUN_LOCAL }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'windows_key', (workspace) => windowsKey(workspace, args.key)));
  server.registerTool('windows_hotkey', { title: 'Windows hotkey', description: 'Send a modifier hotkey combination.', inputSchema: { workspace_id: z.string(), keys: z.array(z.string()).min(1) }, outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: RUN_LOCAL }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'windows_hotkey', (workspace) => windowsHotkey(workspace, args.keys)));
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
  server.registerTool('windows_window_drag', { title: 'Windows window drag', description: 'Drag between client/window-local coordinates for a top-level hwnd.', inputSchema: windowDragSchema(), outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: RUN_LOCAL }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'windows_window_drag', (workspace) => windowsWindowDrag(workspace, args.hwnd, args.from_x, args.from_y, args.to_x, args.to_y, args.coordinate_space, args.focus)));
}

function windowDragSchema() {
  return { workspace_id: z.string(), hwnd: z.number().int().finite(), from_x: finiteNumberSchema, from_y: finiteNumberSchema, to_x: finiteNumberSchema, to_y: finiteNumberSchema, coordinate_space: coordinateSpaceSchema, focus: z.boolean().default(true) };
}

const windowsBatchStepSchema = z.union([
  z.object({ tool: z.string(), args: z.record(z.string(), z.unknown()).default({}) }),
  z.object({ delay_ms: z.number().int().min(0).max(10000) })
]);
