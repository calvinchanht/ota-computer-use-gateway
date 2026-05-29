import { z } from 'zod';
import { runWorkspaceTool } from '../../core/toolRunner.js';
import { approvalStatus, createLocalApproval } from '../../tools/approval.js';
import type { RegisterContext } from './types.js';

export function registerApprovalTools({ server, workspaces }: RegisterContext): void {
  server.registerTool('approval_status', { title: 'Approval status', description: 'List local workspace approvals.', inputSchema: { workspace_id: z.string() } }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'approval_status', approvalStatus));
  server.registerTool('create_local_approval', { title: 'Create local approval', description: 'Record a local approval marker for development/testing.', inputSchema: { workspace_id: z.string(), action: z.string(), approved_by: z.string().optional() } }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'create_local_approval', (workspace) => createLocalApproval(workspace, args.action, args.approved_by)));
}
