import { z } from 'zod';
import { runWorkspaceTool } from '../../core/toolRunner.js';
import { applyPatch } from '../../tools/applyPatch.js';
import { proposePatch } from '../../tools/patch.js';
import { READ_ONLY, WRITE_FILE, RUN_LOCAL, TOOL_RESULT_OUTPUT_SCHEMA } from './annotations.js';
import type { RegisterContext } from './types.js';

export function registerPatchTools({ server, config, workspaces }: RegisterContext): void {
  const changes = z.array(z.object({ path: z.string(), old_text: z.string(), new_text: z.string() }));
  server.registerTool('propose_patch', { title: 'Propose patch', description: 'Store a patch proposal without modifying project files.', inputSchema: { workspace_id: z.string(), reason: z.string(), changes }, outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: WRITE_FILE }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'propose_patch', (workspace) => proposePatch(config, workspace, args.changes, args.reason)));
  server.registerTool('apply_patch', { title: 'Apply patch', description: 'Apply exact-text replacements after local approval.', inputSchema: { workspace_id: z.string(), approval_action: z.string().default('apply_patch'), changes }, outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: WRITE_FILE }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'apply_patch', (workspace) => applyPatch(config, workspace, args.changes, args.approval_action)));
}
