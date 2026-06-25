import { z } from 'zod';
import { asText } from '../../core/result.js';
import { callThreaddexLifecycle } from '../../tools/threaddexLifecycle.js';
import { READ_ONLY, RUN_LOCAL, TOOL_RESULT_OUTPUT_SCHEMA } from './annotations.js';
import type { RegisterContext } from './types.js';

export function registerJobLifecycleTools({ server }: RegisterContext): void {
  for (const name of ['get_job', 'getJob']) {
    server.registerTool(name, {
      title: 'Get Threaddex job',
      description: 'Read a Threaddex job by id before doing work.',
      inputSchema: { job_id: z.string().min(1) },
      outputSchema: TOOL_RESULT_OUTPUT_SCHEMA,
      annotations: READ_ONLY
    }, async (args) => asText(await callThreaddexLifecycle(name, args)));
  }
  for (const name of ['deliver_job_progress', 'deliverJobProgress']) {
    server.registerTool(name, {
      title: 'Deliver Threaddex job progress',
      description: 'Send useful non-final progress for the active job.',
      inputSchema: { job_id: z.string().min(1), text: z.string().min(1), progress_seq: z.union([z.string(), z.number()]).optional() },
      outputSchema: TOOL_RESULT_OUTPUT_SCHEMA,
      annotations: RUN_LOCAL
    }, async (args) => asText(await callThreaddexLifecycle(name, args)));
  }
  registerFinalTools(server);
  registerContinuationTools(server);
}

function registerFinalTools(server: RegisterContext['server']): void {
  for (const name of ['deliver_job', 'deliverJob']) {
    server.registerTool(name, {
      title: 'Deliver Threaddex job final',
      description: 'Send the final answer for the active job.',
      inputSchema: { job_id: z.string().min(1), text: z.string().min(1) },
      outputSchema: TOOL_RESULT_OUTPUT_SCHEMA,
      annotations: RUN_LOCAL
    }, async (args) => asText(await callThreaddexLifecycle(name, args)));
  }
}

function registerContinuationTools(server: RegisterContext['server']): void {
  for (const name of ['request_job_continuation', 'requestJobContinuation']) {
    server.registerTool(name, {
      title: 'Request Threaddex job continuation',
      description: 'Record a continuation checkpoint and ask Threaddex to continue the same job.',
      inputSchema: { job_id: z.string().min(1), checkpoint: z.string().min(1), reason: z.string().optional(), next_prompt: z.string().optional(), max_continuations: z.number().int().min(1).max(999).optional() },
      outputSchema: TOOL_RESULT_OUTPUT_SCHEMA,
      annotations: RUN_LOCAL
    }, async (args) => asText(await callThreaddexLifecycle(name, args)));
  }
}
