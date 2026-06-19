import { z } from 'zod';

export const BROKERED_EXECUTOR_CONTRACT_VERSION = 'brokered-executor-v1' as const;

export const executorJobStateSchema = z.enum(['queued', 'claimed', 'running', 'succeeded', 'failed', 'expired', 'cancelled']);
export type ExecutorJobState = z.infer<typeof executorJobStateSchema>;

export const brokeredExecutorErrorCodeSchema = z.enum([
  'executor_offline',
  'operation_not_allowed',
  'invalid_arguments',
  'operation_failed',
  'timeout',
  'artifact_upload_failed',
  'lease_expired',
  'interactive_session_unavailable',
  'windows_not_supported',
  'powershell_execution_failed',
  'monitor_not_found',
  'multi_monitor_not_allowed',
  'window_enumeration_failed',
  'screenshot_capture_failed',
  'uia_unavailable',
  'artifact_capture_failed',
  'local_ota_unreachable',
  'local_ota_policy_denied'
]);
export type BrokeredExecutorErrorCode = z.infer<typeof brokeredExecutorErrorCodeSchema>;

export const executorArtifactSchema = z.object({
  kind: z.string().min(1),
  mime_type: z.string().min(1),
  url: z.string().url().optional(),
  local_path: z.string().min(1).optional(),
  artifact_path: z.string().min(1).optional(),
  sha256: z.string().min(1).optional(),
  bytes: z.number().int().nonnegative().optional(),
  expires_at: z.string().datetime().optional()
}).passthrough();
export type ExecutorArtifact = z.infer<typeof executorArtifactSchema>;

export const executorResultSchema = z.object({
  status: z.enum(['succeeded', 'failed']),
  result: z.record(z.string(), z.unknown()).default({}),
  artifacts: z.array(executorArtifactSchema).default([]),
  error_code: brokeredExecutorErrorCodeSchema.optional(),
  error_message: z.string().optional(),
  audit: z.record(z.string(), z.unknown()).default({})
});
export type ExecutorResult = z.infer<typeof executorResultSchema>;

export const submitExecutorJobSchema = z.object({
  requester_agent_id: z.string().min(1).optional(),
  target_agent_id: z.string().min(1),
  executor_id: z.string().min(1),
  executor_kind: z.string().min(1),
  operation_name: z.string().min(1),
  operation_arguments: z.record(z.string(), z.unknown()).default({}),
  idempotency_key: z.string().min(1).max(200).optional(),
  ttl_ms: z.number().int().positive().max(10 * 60_000).optional()
});
export type SubmitExecutorJobInput = z.infer<typeof submitExecutorJobSchema>;

export const executorHeartbeatSchema = z.object({
  executor_id: z.string().min(1),
  executor_kind: z.string().min(1),
  contract_version: z.literal(BROKERED_EXECUTOR_CONTRACT_VERSION),
  supported_operations: z.array(z.string().min(1)).default([])
});
export type ExecutorHeartbeatInput = z.infer<typeof executorHeartbeatSchema>;

export const executorClaimSchema = z.object({
  executor_id: z.string().min(1),
  executor_kind: z.string().min(1),
  lease_ms: z.number().int().positive().max(10 * 60_000).optional()
});
export type ExecutorClaimInput = z.infer<typeof executorClaimSchema>;

export const completeExecutorJobSchema = z.object({
  executor_id: z.string().min(1),
  lease_owner: z.string().min(1),
  result: executorResultSchema
});
export type CompleteExecutorJobInput = z.infer<typeof completeExecutorJobSchema>;

export type BrokeredExecutorConfig = {
  enabled: boolean;
  include_action_schema?: boolean;
  default_ttl_ms: number;
  default_lease_ms: number;
  executors: BrokeredExecutorDefinition[];
};

export type BrokeredExecutorDefinition = {
  executor_id: string;
  executor_kind: string;
  agent_id: string;
  enabled: boolean;
  allowed_operations: string[];
  default_lease_ms?: number;
  max_ttl_ms?: number;
  worker_bearer_token_env?: string;
};

export type BrokeredExecutorJob = {
  broker_job_id: string;
  requester_agent_id?: string;
  target_agent_id: string;
  executor_id: string;
  executor_kind: string;
  operation_name: string;
  operation_arguments: Record<string, unknown>;
  state: ExecutorJobState;
  idempotency_key?: string;
  lease_owner?: string;
  lease_expires_at?: string;
  ttl_expires_at: string;
  result?: ExecutorResult;
  artifacts: ExecutorArtifact[];
  error_code?: BrokeredExecutorErrorCode;
  error_message?: string;
  created_at: string;
  claimed_at?: string;
  started_at?: string;
  finished_at?: string;
  audit: Array<Record<string, unknown>>;
};

export type ExecutorHeartbeat = ExecutorHeartbeatInput & { last_seen_at: string };
