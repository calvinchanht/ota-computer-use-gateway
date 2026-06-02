import { z } from 'zod';

export const browserProfileSchema = z.object({
  label: z.string().min(1).optional(),
  user_data_dir: z.string().min(1).optional(),
  cdp_host: z.string().min(1).default('127.0.0.1'),
  cdp_port: z.number().int().positive().default(9222),
  display: z.string().min(1).optional(),
  headed: z.boolean().default(true),
  default: z.boolean().default(false),
  launch: z.boolean().default(false)
});

export const browserSchema = z.object({
  profiles: z.array(browserProfileSchema).default([])
}).default({ profiles: [] });

export const apiSetsSchema = z.object({
  workspace: z.boolean().optional(),
  browser: z.boolean().optional(),
  computer: z.boolean().optional(),
  machine_admin: z.boolean().optional(),
  estate_admin: z.boolean().optional()
}).default({});

const workspaceBaseSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  root: z.string().min(1),
  agent_dir: z.string().min(1).optional(),
  allow_read: z.boolean().default(true),
  allow_write: z.boolean().default(false),
  allow_patch: z.boolean().default(false),
  allow_tests: z.boolean().default(false),
  allow_screen: z.boolean().default(false),
  allow_mouse_keyboard: z.boolean().default(false),
  api_sets: apiSetsSchema,
  browser: browserSchema,
  commands: z.record(z.string(), z.string()).default({}),
  git: z.object({ github_token_file: z.string().min(1).optional() }).default({})
});

export const workspaceSchema = workspaceBaseSchema.transform((workspace) => {
  const sets = workspace.api_sets;
  const hasSets = Object.keys(sets).length > 0;
  if (!hasSets) return workspace;

  const next = { ...workspace, api_sets: { ...sets } };
  if (sets.workspace) {
    next.allow_read = true;
    next.allow_write = true;
    next.allow_patch = true;
    next.allow_tests = true;
  }
  if (sets.browser || sets.computer) {
    next.allow_screen = true;
    next.allow_mouse_keyboard = true;
  }
  if (sets.machine_admin) {
    next.allow_tests = true;
  }
  return next;
});

export const authSchema = z.object({
  enabled: z.boolean().default(false),
  bearer_token_env: z.string().min(1).default('OTA_GATEWAY_BEARER_TOKEN'),
  allow_loopback_without_auth: z.boolean().default(true)
});

export const rateLimitSchema = z.object({
  enabled: z.boolean().default(true),
  window_ms: z.number().int().positive().default(60000),
  max_requests: z.number().int().positive().default(120),
  trust_proxy_headers: z.boolean().default(false)
});

export const configSchema = z.object({
  server: z.object({
    host: z.string().default('127.0.0.1'),
    port: z.number().int().positive().default(8765),
    auth: authSchema.prefault({}),
    rate_limit: rateLimitSchema.prefault({}),
    tool_annotations: z.object({
      mode: z.enum(['honest', 'private_high_autonomy']).default('honest')
    }).prefault({}),
    exposed_tools: z.array(z.string().min(1)).default([])
  }).prefault({}),
  workspaces: z.array(workspaceSchema).min(1),
  security: z.object({
    max_file_bytes: z.number().int().positive().default(200000),
    max_response_bytes: z.number().int().positive().default(50000),
    max_request_bytes: z.number().int().positive().default(1000000),
    max_search_results: z.number().int().positive().default(50),
    max_exec_ms: z.number().int().positive().default(120000),
    protect_secret_paths: z.boolean().default(true),
    denied_globs: z.array(z.string()).default([])
  }).prefault({})
});

export type AppConfig = z.infer<typeof configSchema>;
export type WorkspaceConfig = z.infer<typeof workspaceSchema>;
