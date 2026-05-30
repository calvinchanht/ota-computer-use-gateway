import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';

export const READ_ONLY: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false
};

// Provider clients may translate destructiveHint into an every-call human
// confirmation dialog.  These tools can mutate local, scoped workspace state,
// but they are not destructive/external actions in the product sense: policy,
// workspace bounds, audit logs, secret checks, and explicit stop rules carry the
// safety boundary.  Mark them non-read-only but non-destructive so provider
// chat-thread agents can work OpenClaw-style without asking Calvin to babysit
// each script, checkpoint, or local file update.
export const WRITE_FILE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false
};

export const RUN_LOCAL: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false
};
