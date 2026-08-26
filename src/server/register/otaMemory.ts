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
// Keep these provider-facing schemas as plain objects. Some connector projections collapse
// array-item unions to any[], so kind-specific requirements stay in server-side refinements.
const replacementCandidate = z.object({
  kind: z.enum(['observation', 'outcome', 'tool_evidence']),
  content: z.string().min(1).optional().describe('Required when replacement kind=observation.'),
  summary: z.string().min(1).optional().describe('Required when replacement kind=outcome or tool_evidence.'),
  reason: z.string().min(1).optional(), event_type: z.string().optional(),
  source_refs: sourceRefs.describe('Required when replacement kind=tool_evidence.')
}).passthrough().superRefine((value, context) => {
  if (value.kind === 'observation' && value.content === undefined) {
    context.addIssue({ code: 'custom', path: ['content'], message: 'content is required for observation replacement' });
  }
  if (value.kind !== 'observation' && value.summary === undefined) {
    context.addIssue({ code: 'custom', path: ['summary'], message: 'summary is required for outcome/tool_evidence replacement' });
  }
  if (value.kind === 'tool_evidence' && value.source_refs === undefined) {
    context.addIssue({ code: 'custom', path: ['source_refs'], message: 'source_refs is required for tool_evidence replacement' });
  }
});
const commitCandidate = z.object({
  candidate_key: z.string().min(1),
  kind: z.enum(['observation', 'outcome', 'tool_evidence', 'correction', 'forget', 'supersession']),
  reason: z.string().min(1),
  content: z.string().min(1).optional().describe('Required when kind=observation.'),
  summary: z.string().min(1).optional().describe('Required when kind=outcome or tool_evidence.'),
  event_type: z.string().optional(),
  source_refs: sourceRefs.describe('Required when kind=tool_evidence.'),
  target: memoryTarget.optional().describe('Required when kind=correction, forget, or supersession.'),
  replacement: replacementCandidate.optional().describe('Required when kind=supersession; optional for correction.')
}).passthrough().superRefine((value, context) => {
  if (value.kind === 'observation' && value.content === undefined) {
    context.addIssue({ code: 'custom', path: ['content'], message: 'content is required for observation candidate' });
  }
  if (['outcome', 'tool_evidence'].includes(value.kind) && value.summary === undefined) {
    context.addIssue({ code: 'custom', path: ['summary'], message: 'summary is required for outcome/tool_evidence candidate' });
  }
  if (value.kind === 'tool_evidence' && value.source_refs === undefined) {
    context.addIssue({ code: 'custom', path: ['source_refs'], message: 'source_refs is required for tool_evidence candidate' });
  }
  if (['correction', 'forget', 'supersession'].includes(value.kind) && value.target === undefined) {
    context.addIssue({ code: 'custom', path: ['target'], message: 'target is required for correction/forget/supersession candidate' });
  }
  if (value.kind === 'supersession' && value.replacement === undefined) {
    context.addIssue({ code: 'custom', path: ['replacement'], message: 'replacement is required for supersession candidate' });
  }
});

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
    description: 'Commit explicit lifecycle-v1 candidates. All require candidate_key/kind/reason. observation requires content; outcome requires summary; tool_evidence requires summary+source_refs; correction/forget require target; supersession requires target+replacement. Replacement observation requires content; replacement outcome/tool_evidence require summary; replacement tool_evidence also requires source_refs.',
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
