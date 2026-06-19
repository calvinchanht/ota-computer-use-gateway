import { z } from 'zod';
import type { BrokeredExecutorConfig, BrokeredExecutorDefinition } from './types.js';

export const brokeredExecutorDefinitionSchema = z.object({
  executor_id: z.string().min(1),
  executor_kind: z.string().min(1),
  agent_id: z.string().min(1),
  enabled: z.boolean().default(false),
  allowed_operations: z.array(z.string().min(1)).default([]),
  default_lease_ms: z.number().int().positive().max(10 * 60_000).optional(),
  max_ttl_ms: z.number().int().positive().max(10 * 60_000).optional(),
  worker_bearer_token_env: z.string().min(1).optional()
});

export const brokeredExecutorsConfigSchema = z.object({
  enabled: z.boolean().default(false),
  include_action_schema: z.boolean().default(false),
  default_ttl_ms: z.number().int().positive().max(10 * 60_000).default(60_000),
  default_lease_ms: z.number().int().positive().max(10 * 60_000).default(30_000),
  executors: z.array(brokeredExecutorDefinitionSchema).default([])
}).default({ enabled: false, include_action_schema: false, default_ttl_ms: 60_000, default_lease_ms: 30_000, executors: [] });

export function brokeredExecutorEnabled(config: { brokered_executors?: BrokeredExecutorConfig }): boolean {
  return config.brokered_executors?.enabled === true;
}

export function enabledExecutor(config: { brokered_executors?: BrokeredExecutorConfig }, executorId: string): BrokeredExecutorDefinition | undefined {
  if (!brokeredExecutorEnabled(config)) return undefined;
  return config.brokered_executors?.executors.find((executor) => executor.enabled && executor.executor_id === executorId);
}

export function operationAllowed(executor: BrokeredExecutorDefinition, operationName: string): boolean {
  return executor.allowed_operations.includes(operationName);
}
