import { z } from 'zod';
import { runWorkspaceTool } from '../../core/toolRunner.js';
import { cuaDriverBatch, cuaDriverCall, cuaDriverStatus } from '../../tools/computer.js';
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
  windowsScreenshot,
  windowsScroll,
  windowsTypeText,
  windowsUiaTree
} from '../../tools/windowsComputer.js';
import { READ_ONLY, RUN_LOCAL, TOOL_RESULT_OUTPUT_SCHEMA } from './annotations.js';
import type { RegisterContext } from './types.js';

const cuaBatchStepSchema = z.union([
  z.object({ method: z.string().min(1).max(80), params: z.record(z.string(), z.unknown()).default({}) }),
  z.object({ delay_ms: z.number().int().min(0).max(5000) })
]);
const finiteNumberSchema = z.number().refine(Number.isFinite, 'must be finite');
const mouseButtonSchema = z.enum(['left', 'right']).default('left');

export function registerComputerTools(context: RegisterContext): void {
  registerCuaDriverStatus(context);
  registerCuaDriverCall(context);
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
    description: 'Call one raw Cua Driver command for Mac computer use. Gateway only provides auth, workspace scoping, policy, audit, limits, and bounded output; use Cua Driver method names and params directly.',
    inputSchema: { workspace_id: z.string(), method: z.string().min(1).max(80), params: z.record(z.string(), z.unknown()).default({}) },
    outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: RUN_LOCAL
  }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'cua_driver_call', (workspace) => cuaDriverCall(workspace, args.method, args.params)));
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
  server.registerTool('windows_click', { title: 'Windows click', description: 'Move the mouse and click at screen coordinates.', inputSchema: { workspace_id: z.string(), x: finiteNumberSchema, y: finiteNumberSchema, button: mouseButtonSchema }, outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: RUN_LOCAL }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'windows_click', (workspace) => windowsClick(workspace, args.x, args.y, args.button)));
  server.registerTool('windows_double_click', { title: 'Windows double click', description: 'Move the mouse and double click at screen coordinates.', inputSchema: { workspace_id: z.string(), x: finiteNumberSchema, y: finiteNumberSchema, button: mouseButtonSchema }, outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: RUN_LOCAL }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'windows_double_click', (workspace) => windowsDoubleClick(workspace, args.x, args.y, args.button)));
  server.registerTool('windows_drag', { title: 'Windows drag', description: 'Drag from one screen coordinate to another.', inputSchema: { workspace_id: z.string(), from_x: finiteNumberSchema, from_y: finiteNumberSchema, to_x: finiteNumberSchema, to_y: finiteNumberSchema }, outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: RUN_LOCAL }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'windows_drag', (workspace) => windowsDrag(workspace, args.from_x, args.from_y, args.to_x, args.to_y)));
  server.registerTool('windows_scroll', { title: 'Windows scroll', description: 'Scroll at screen coordinates.', inputSchema: { workspace_id: z.string(), x: finiteNumberSchema, y: finiteNumberSchema, delta: finiteNumberSchema }, outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: RUN_LOCAL }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'windows_scroll', (workspace) => windowsScroll(workspace, args.x, args.y, args.delta)));
  server.registerTool('windows_type_text', { title: 'Windows type text', description: 'Type text into the active Windows UI.', inputSchema: { workspace_id: z.string(), text: z.string() }, outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: RUN_LOCAL }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'windows_type_text', (workspace) => windowsTypeText(workspace, args.text)));
  server.registerTool('windows_key', { title: 'Windows key', description: 'Send a Windows Forms SendKeys key sequence.', inputSchema: { workspace_id: z.string(), key: z.string() }, outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: RUN_LOCAL }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'windows_key', (workspace) => windowsKey(workspace, args.key)));
  server.registerTool('windows_hotkey', { title: 'Windows hotkey', description: 'Send a modifier hotkey combination.', inputSchema: { workspace_id: z.string(), keys: z.array(z.string()).min(1) }, outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: RUN_LOCAL }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'windows_hotkey', (workspace) => windowsHotkey(workspace, args.keys)));
  server.registerTool('windows_clipboard_get', { title: 'Windows clipboard get', description: 'Read Windows clipboard text.', inputSchema: { workspace_id: z.string() }, outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: READ_ONLY }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'windows_clipboard_get', windowsClipboardGet));
  server.registerTool('windows_clipboard_set', { title: 'Windows clipboard set', description: 'Set Windows clipboard text.', inputSchema: { workspace_id: z.string(), text: z.string() }, outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: RUN_LOCAL }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'windows_clipboard_set', (workspace) => windowsClipboardSet(workspace, args.text)));
  server.registerTool('windows_batch', { title: 'Windows computer batch', description: 'Run a sequence of Windows computer-use input actions and delay steps.', inputSchema: { workspace_id: z.string(), calls: z.array(windowsBatchStepSchema).min(1).max(50) }, outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: RUN_LOCAL }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'windows_batch', (workspace) => windowsBatch(workspace, args.calls as any)));
}

const windowsBatchStepSchema = z.union([
  z.object({ tool: z.string(), args: z.record(z.string(), z.unknown()).default({}) }),
  z.object({ delay_ms: z.number().int().min(0).max(10000) })
]);
