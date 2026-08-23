import { z } from 'zod';
import { runWorkspaceTool } from '../../core/toolRunner.js';
import { otaMemoryCall, type OtaMemoryOperation } from '../../tools/otaMemory.js';
import { READ_ONLY, TOOL_RESULT_OUTPUT_SCHEMA, WRITE_FILE } from './annotations.js';
import type { RegisterContext } from './types.js';
import { redactSecretValuesEnabled, sanitizeResultsEnabled } from '../../core/securityPolicy.js';

const sessionSchema = z.object({
  session_id: z.string().optional(), provider: z.string().optional(),
  thread_id: z.string().optional(), job_id: z.string().optional()
}).optional();
const executionHandle = z.string().min(1).optional();
const sourceRefs = z.record(z.string(), z.unknown()).optional();
const memoryTarget = z.object({ record_type: z.string().min(1), record_id: z.string().min(1) });
const observationCandidate = z.object({
  candidate_key: z.string().min(1), kind: z.literal('observation'), content: z.string().min(1),
  reason: z.string().min(1), source_refs: sourceRefs
}).passthrough();
const outcomeCandidate = z.object({
  candidate_key: z.string().min(1), kind: z.literal('outcome'), summary: z.string().min(1),
  reason: z.string().min(1), event_type: z.string().optional(), source_refs: sourceRefs
}).passthrough();
const evidenceCandidate = z.object({
  candidate_key: z.string().min(1), kind: z.literal('tool_evidence'), summary: z.string().min(1),
  reason: z.string().min(1), source_refs: z.record(z.string(), z.unknown())
}).passthrough();
const replacementObservation = z.object({
  kind: z.literal('observation'), content: z.string().min(1),
  reason: z.string().min(1).optional(), source_refs: sourceRefs
}).passthrough();
const replacementOutcome = z.object({
  kind: z.literal('outcome'), summary: z.string().min(1),
  reason: z.string().min(1).optional(), event_type: z.string().optional(), source_refs: sourceRefs
}).passthrough();
const replacementEvidence = z.object({
  kind: z.literal('tool_evidence'), summary: z.string().min(1),
  reason: z.string().min(1).optional(), source_refs: z.record(z.string(), z.unknown())
}).passthrough();
const replacementCandidate = z.union([replacementObservation, replacementOutcome, replacementEvidence]);
const commitCandidate = z.discriminatedUnion('kind', [
  observationCandidate, outcomeCandidate, evidenceCandidate,
  z.object({ candidate_key: z.string().min(1), kind: z.literal('correction'), target: memoryTarget,
    reason: z.string().min(1), replacement: replacementCandidate.optional() }).passthrough(),
  z.object({ candidate_key: z.string().min(1), kind: z.literal('forget'), target: memoryTarget,
    reason: z.string().min(1) }).passthrough(),
  z.object({ candidate_key: z.string().min(1), kind: z.literal('supersession'), target: memoryTarget,
    replacement: replacementCandidate, reason: z.string().min(1) }).passthrough()
]);

export function registerOtaMemoryTools(context: RegisterContext): void {
  context.server.registerTool('memory_begin_turn', beginTurnSpec(), async (args) => memoryCall(context, 'memory_begin_turn', 'memory.begin_turn', args));
  context.server.registerTool('memory_commit_turn', commitTurnSpec(), async (args) => memoryCall(context, 'memory_commit_turn', 'memory.commit_turn', args));
  context.server.registerTool('memory_flush_session', flushSessionSpec(), async (args) => memoryCall(context, 'memory_flush_session', 'memory.flush_session', args));
}

function memoryCall(context: RegisterContext, name: string, operation: OtaMemoryOperation, args: Record<string, unknown>) {
  return runWorkspaceTool(context.workspaces, String(args.workspace_id), name, (workspace) => otaMemoryCall(workspace, operation, args, sanitizeResultsEnabled(context.config) || redactSecretValuesEnabled(context.config)));
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
    description: 'Commit explicit lifecycle-v1 candidates. Each candidate requires candidate_key, kind, reason, and the kind-specific content shown by the schema.',
    inputSchema: {
      workspace_id: z.string(), request_id: z.string().min(1), idempotency_key: z.string().min(1),
      candidates: z.array(commitCandidate), execution_handle: executionHandle, session: sessionSchema
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
