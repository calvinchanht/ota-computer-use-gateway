import { z } from 'zod';
import { runWorkspaceTool } from '../../core/toolRunner.js';
import { otaMemoryCall, type OtaMemoryOperation } from '../../tools/otaMemory.js';
import { READ_ONLY, TOOL_RESULT_OUTPUT_SCHEMA, WRITE_FILE } from './annotations.js';
import type { RegisterContext } from './types.js';

const sessionSchema = z.object({
  session_id: z.string().optional(), provider: z.string().optional(),
  thread_id: z.string().optional(), job_id: z.string().optional()
}).optional();
const executionHandle = z.string().min(1).optional();

export function registerOtaMemoryTools(context: RegisterContext): void {
  if (![...context.workspaces.values()].some((workspace) => workspace.ota_memory?.enabled)) return;
  context.server.registerTool('memory_begin_turn', beginTurnSpec(), async (args) => memoryCall(context, 'memory_begin_turn', 'memory.begin_turn', args));
  context.server.registerTool('memory_commit_turn', commitTurnSpec(), async (args) => memoryCall(context, 'memory_commit_turn', 'memory.commit_turn', args));
  context.server.registerTool('memory_flush_session', flushSessionSpec(), async (args) => memoryCall(context, 'memory_flush_session', 'memory.flush_session', args));
}

function memoryCall(context: RegisterContext, name: string, operation: OtaMemoryOperation, args: Record<string, unknown>) {
  return runWorkspaceTool(context.workspaces, String(args.workspace_id), name, (workspace) => otaMemoryCall(workspace, operation, args));
}

function beginTurnSpec() {
  return {
    title: 'Memory begin turn',
    description: 'Retrieve one bounded, scoped OTA-Memory lifecycle-v1 context receipt. Database and identity scope are server-owned.',
    inputSchema: {
      workspace_id: z.string(), request_id: z.string().min(1), intent: z.string().min(1),
      execution_handle: executionHandle, session: sessionSchema, resume_seed: z.string().optional(),
      relationship_mode: z.enum(['none', 'one_hop']).optional(), budget: z.record(z.string(), z.unknown()).optional()
    },
    outputSchema: TOOL_RESULT_OUTPUT_SCHEMA,
    annotations: READ_ONLY
  };
}

function commitTurnSpec() {
  return {
    title: 'Memory commit turn',
    description: 'Commit only explicit OTA-Memory lifecycle-v1 candidates with durable idempotency and complete receipts.',
    inputSchema: {
      workspace_id: z.string(), request_id: z.string().min(1), idempotency_key: z.string().min(1),
      candidates: z.array(z.record(z.string(), z.unknown())), execution_handle: executionHandle, session: sessionSchema
    },
    outputSchema: TOOL_RESULT_OUTPUT_SCHEMA,
    annotations: WRITE_FILE
  };
}

function flushSessionSpec() {
  return {
    title: 'Memory flush session',
    description: 'Persist one bounded provider-independent OTA-Memory lifecycle-v1 handoff with a complete replay receipt.',
    inputSchema: {
      workspace_id: z.string(), request_id: z.string().min(1), idempotency_key: z.string().min(1),
      execution_handle: executionHandle, session: sessionSchema, reason: z.string().optional(),
      active_task: z.string().optional(), transcript_summary: z.string().optional(),
      decisions: z.array(z.string()).optional(), open_questions: z.array(z.string()).optional(),
      artifacts: z.array(z.string()).optional(), risks: z.array(z.string()).optional(),
      next_actions: z.array(z.string()).optional(), source_record_refs: z.array(z.string()).optional(),
      budget: z.record(z.string(), z.unknown()).optional()
    },
    outputSchema: TOOL_RESULT_OUTPUT_SCHEMA,
    annotations: WRITE_FILE
  };
}
