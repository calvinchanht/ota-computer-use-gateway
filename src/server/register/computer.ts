import { z } from 'zod';
import { runWorkspaceTool } from '../../core/toolRunner.js';
import { cuaDriverBatch, cuaDriverCall, cuaDriverStatus } from '../../tools/computer.js';
import { READ_ONLY, RUN_LOCAL, TOOL_RESULT_OUTPUT_SCHEMA } from './annotations.js';
import type { RegisterContext } from './types.js';

const cuaBatchStepSchema = z.union([
  z.object({ method: z.string().min(1).max(80), params: z.record(z.string(), z.unknown()).default({}) }),
  z.object({ delay_ms: z.number().int().min(0).max(5000) })
]);

export function registerComputerTools(context: RegisterContext): void {
  registerCuaDriverStatus(context);
  registerCuaDriverCall(context);
  registerCuaDriverBatch(context);
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
