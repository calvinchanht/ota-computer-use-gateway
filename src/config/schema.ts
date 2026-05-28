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

export const configSchema = z.object({
  server: z.object({
    host: z.string().default('127.0.0.1'),
    port: z.number().int().positive().default(8765)
  }).prefault({}),
  workspaces: z.array(workspaceSchema).min(1),
  security: z.object({
    max_file_bytes: z.number().int().positive().default(200000),
    max_response_bytes: z.number().int().positive().default(50000),
    max_search_results: z.number().int().positive().default(50),
    denied_globs: z.array(z.string()).default([])
  }).prefault({})
});

export type AppConfig = z.infer<typeof configSchema>;
export type WorkspaceConfig = z.infer<typeof workspaceSchema>;
