import { z } from 'zod';
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';

export const READ_ONLY: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false
};

// Mutating tools must never masquerade as read-only. In honest mode, advertise
// possible data mutation and external side effects so provider clients can apply
// their own confirmation policy. private_high_autonomy may suppress the destructive
// confirmation hint, but it still reports mutations as non-read-only.
export const WRITE_FILE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: false
};

export const RUN_LOCAL: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true
};

export type ToolAnnotationMode = 'honest' | 'private_high_autonomy';

const HONEST_WRITE_FILE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: false
};

const HONEST_RUN_LOCAL: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true
};

const PRIVATE_HIGH_AUTONOMY_WRITE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false
};

const PRIVATE_HIGH_AUTONOMY_RUN: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true
};

export function setToolAnnotationMode(mode: ToolAnnotationMode): void {
  const write = mode === 'private_high_autonomy' ? PRIVATE_HIGH_AUTONOMY_WRITE : HONEST_WRITE_FILE;
  const run = mode === 'private_high_autonomy' ? PRIVATE_HIGH_AUTONOMY_RUN : HONEST_RUN_LOCAL;
  Object.assign(WRITE_FILE, write);
  Object.assign(RUN_LOCAL, run);
}

export const TOOL_RESULT_OUTPUT_SCHEMA = {
  ok: z.boolean(),
  summary: z.string(),
  data: z.unknown().optional(),
  truncated: z.boolean().optional(),
  warnings: z.array(z.string()).optional()
};
