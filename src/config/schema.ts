import { z } from 'zod';

export const workspaceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  root: z.string().min(1),
  allow_read: z.boolean().default(true),
  allow_patch: z.boolean().default(false),
  allow_tests: z.boolean().default(false),
  allow_screen: z.boolean().default(false),
  allow_mouse_keyboard: z.boolean().default(false),
  commands: z.record(z.string(), z.string()).default({})
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
    rate_limit: rateLimitSchema.prefault({})
  }).prefault({}),
  workspaces: z.array(workspaceSchema).min(1),
  security: z.object({
    max_file_bytes: z.number().int().positive().default(200000),
    max_response_bytes: z.number().int().positive().default(50000),
    max_request_bytes: z.number().int().positive().default(1000000),
    max_search_results: z.number().int().positive().default(50),
    denied_globs: z.array(z.string()).default([])
  }).prefault({})
});

export type AppConfig = z.infer<typeof configSchema>;
export type WorkspaceConfig = z.infer<typeof workspaceSchema>;
