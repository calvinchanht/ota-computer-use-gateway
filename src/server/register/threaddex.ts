import { z } from 'zod';
import { runWorkspaceTool } from '../../core/toolRunner.js';
import { threaddexDeliverJob, threaddexDeliverJobProgress, threaddexGetJob } from '../../tools/threaddex.js';
import { READ_ONLY, RUN_LOCAL, TOOL_RESULT_OUTPUT_SCHEMA } from './annotations.js';
import type { RegisterContext } from './types.js';

export function registerThreaddexTools({ server, workspaces }: RegisterContext): void {
  server.registerTool('threaddex_get_job', {
    title: 'Threaddex get job',
    description: 'Read a job from the local configured Threaddex Job API through this agent gateway. Use this instead of confusing the OTA/Mac gateway with generic getJob tool names.',
    inputSchema: { workspace_id: z.string(), job_id: z.string().min(1) },
    outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: READ_ONLY
  }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'threaddex_get_job', (workspace) => threaddexGetJob(workspace, args.job_id)));

  server.registerTool('threaddex_deliver_job_progress', {
    title: 'Threaddex deliver job progress',
    description: 'Send a non-terminal progress update to the local configured Threaddex Job API through this agent gateway.',
    inputSchema: { workspace_id: z.string(), job_id: z.string().min(1), text: z.string().min(1), seq: z.union([z.string(), z.number()]).optional(), protocol_version: z.string().optional(), schema_version: z.string().optional() },
    outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: RUN_LOCAL
  }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'threaddex_deliver_job_progress', (workspace) => threaddexDeliverJobProgress(workspace, args.job_id, args.text, args.seq, args.protocol_version, args.schema_version)));

  server.registerTool('threaddex_deliver_job', {
    title: 'Threaddex deliver job',
    description: 'Send final job text to the local configured Threaddex Job API through this agent gateway.',
    inputSchema: { workspace_id: z.string(), job_id: z.string().min(1), text: z.string().min(1), protocol_version: z.string().optional(), schema_version: z.string().optional() },
    outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: RUN_LOCAL
  }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'threaddex_deliver_job', (workspace) => threaddexDeliverJob(workspace, args.job_id, args.text, args.protocol_version, args.schema_version)));
}
