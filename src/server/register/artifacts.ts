import { z } from 'zod';
import { runWorkspaceTool } from '../../core/toolRunner.js';
import { listArtifacts, recordArtifact } from '../../tools/artifacts.js';
import { READ_ONLY, WRITE_FILE, TOOL_RESULT_OUTPUT_SCHEMA } from './annotations.js';
import type { RegisterContext } from './types.js';

export function registerArtifactTools(context: RegisterContext): void {
  registerListArtifacts(context);
  registerRecordArtifact(context);
}

function registerListArtifacts({ server, workspaces }: RegisterContext): void {
  server.registerTool('list_artifacts', { title: 'List artifacts', description: 'List durable workspace artifact references recorded by provider-thread agents.', inputSchema: { workspace_id: z.string() }, outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: READ_ONLY }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'list_artifacts', listArtifacts));
}

function registerRecordArtifact({ server, workspaces }: RegisterContext): void {
  server.registerTool('record_artifact', { title: 'Record artifact', description: 'Record a workspace-relative artifact path for later provider-thread pickup.', inputSchema: { workspace_id: z.string(), path: z.string(), title: z.string(), kind: z.string().optional(), description: z.string().optional() }, outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: WRITE_FILE }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'record_artifact', (workspace) => recordArtifact(workspace, args.path, args.title, args.kind, args.description ?? '')));
}
