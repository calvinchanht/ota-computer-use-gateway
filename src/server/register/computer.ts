import { z } from 'zod';
import { runWorkspaceTool } from '../../core/toolRunner.js';
import { computerStatus, observeScreen } from '../../tools/computer.js';
import { READ_ONLY } from './annotations.js';
import type { RegisterContext } from './types.js';

export function registerComputerTools(context: RegisterContext): void {
  registerComputerStatus(context);
  registerObserveScreen(context);
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
