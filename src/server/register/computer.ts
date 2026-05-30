import { z } from 'zod';
import { runWorkspaceTool } from '../../core/toolRunner.js';
import { computerClick, computerHotkey, computerPressKey, computerStatus, computerTypeText, observeScreen } from '../../tools/computer.js';
import { READ_ONLY, RUN_LOCAL } from './annotations.js';
import type { RegisterContext } from './types.js';

const observeAfterSchema = z.object({
  delay_ms: z.number().int().min(0).max(5000).optional(),
  screenshot: z.boolean().optional(),
  include_window_tree: z.boolean().optional()
}).optional();

export function registerComputerTools(context: RegisterContext): void {
  registerComputerStatus(context);
  registerObserveScreen(context);
  registerComputerClick(context);
  registerComputerTypeText(context);
  registerComputerPressKey(context);
  registerComputerHotkey(context);
}

function registerComputerStatus({ server, workspaces }: RegisterContext): void {
  server.registerTool('computer_status', {
    title: 'Computer status',
    description: 'Return local computer-use capability status for a workspace.',
    inputSchema: { workspace_id: z.string() },
    annotations: READ_ONLY
  }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'computer_status', computerStatus));
}

function registerObserveScreen({ server, workspaces }: RegisterContext): void {
  server.registerTool('observe_screen', {
    title: 'Observe screen',
    description: 'Return a bounded screen observation when a platform adapter is enabled.',
    inputSchema: { workspace_id: z.string() },
    annotations: READ_ONLY
  }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'observe_screen', observeScreen));
}

function registerComputerClick({ server, workspaces }: RegisterContext): void {
  server.registerTool('computer_click', {
    title: 'Computer click',
    description: 'Click screen/window coordinates through the local computer-use adapter. Mutating; requires workspace mouse/keyboard policy.',
    inputSchema: { workspace_id: z.string(), pid: z.number().int().positive(), x: z.number(), y: z.number(), window_id: z.number().int().positive().optional(), observe_after: observeAfterSchema },
    annotations: RUN_LOCAL
  }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'computer_click', (workspace) => computerClick(workspace, args.pid, args.x, args.y, args.window_id, args.observe_after)));
}

function registerComputerTypeText({ server, workspaces }: RegisterContext): void {
  server.registerTool('computer_type_text', {
    title: 'Computer type text',
    description: 'Type text through the local computer-use adapter. Mutating; requires workspace mouse/keyboard policy.',
    inputSchema: { workspace_id: z.string(), pid: z.number().int().positive(), text: z.string().max(10000), window_id: z.number().int().positive().optional(), element_index: z.number().int().nonnegative().optional(), delay_ms: z.number().int().min(0).max(5000).optional(), observe_after: observeAfterSchema },
    annotations: RUN_LOCAL
  }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'computer_type_text', (workspace) => computerTypeText(workspace, args.pid, args.text, args.window_id, args.element_index, args.delay_ms, args.observe_after)));
}

function registerComputerPressKey({ server, workspaces }: RegisterContext): void {
  server.registerTool('computer_press_key', {
    title: 'Computer press key',
    description: 'Press one key through the local computer-use adapter. Mutating; requires workspace mouse/keyboard policy.',
    inputSchema: { workspace_id: z.string(), pid: z.number().int().positive(), key: z.string().min(1).max(64), window_id: z.number().int().positive().optional(), modifiers: z.array(z.string().min(1).max(32)).max(8).optional(), element_index: z.number().int().nonnegative().optional(), observe_after: observeAfterSchema },
    annotations: RUN_LOCAL
  }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'computer_press_key', (workspace) => computerPressKey(workspace, args.pid, args.key, args.window_id, args.modifiers, args.element_index, args.observe_after)));
}

function registerComputerHotkey({ server, workspaces }: RegisterContext): void {
  server.registerTool('computer_hotkey', {
    title: 'Computer hotkey',
    description: 'Press a key combination through the local computer-use adapter. Mutating; requires workspace mouse/keyboard policy.',
    inputSchema: { workspace_id: z.string(), pid: z.number().int().positive(), keys: z.array(z.string().min(1).max(32)).min(2).max(8), window_id: z.number().int().positive().optional(), observe_after: observeAfterSchema },
    annotations: RUN_LOCAL
  }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'computer_hotkey', (workspace) => computerHotkey(workspace, args.pid, args.keys, args.window_id, args.observe_after)));
}
