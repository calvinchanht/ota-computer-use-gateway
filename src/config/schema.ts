import { z } from 'zod';
import { brokeredExecutorsConfigSchema } from '../brokeredExecutor/config.js';

export const DEFAULT_MAX_PROCESS_MS = 60 * 60 * 1000;

export const browserProfileSchema = z.object({
  label: z.string().min(1).optional(),
  purpose: z.enum(['work', 'threaddex']).optional(),
  user_data_dir: z.string().min(1).optional(),
  cdp_host: z.string().min(1).default('127.0.0.1'),
  cdp_port: z.number().int().positive().default(9222),
  display: z.string().min(1).optional(),
  headed: z.boolean().default(true),
  default: z.boolean().default(false),
  launch: z.boolean().default(false)
});

export const browserSchema = z.object({
  max_open_work_pages: z.number().int().positive().max(100).optional(),
  profiles: z.array(browserProfileSchema).default([])
}).superRefine((browser, context) => {
  const work = browser.profiles.filter((profile) => (profile.purpose ?? 'work') === 'work');
  const threaddex = browser.profiles.filter((profile) => profile.purpose === 'threaddex');
  for (const workProfile of work) {
    for (const threaddexProfile of threaddex) {
      if (workProfile.cdp_host === threaddexProfile.cdp_host && workProfile.cdp_port === threaddexProfile.cdp_port) {
        context.addIssue({
          code: 'custom',
          path: ['profiles'],
          message: `work and threaddex browser profiles must use different CDP endpoints: ${workProfile.label ?? 'work'} / ${threaddexProfile.label ?? 'threaddex'}`
        });
      }
      if (workProfile.user_data_dir && threaddexProfile.user_data_dir && workProfile.user_data_dir === threaddexProfile.user_data_dir) {
        context.addIssue({
          code: 'custom',
          path: ['profiles'],
          message: `work and threaddex browser profiles must use different user_data_dir values: ${workProfile.label ?? 'work'} / ${threaddexProfile.label ?? 'threaddex'}`
        });
      }
    }
  }
}).default({ profiles: [] });

export const windowsComputerSchema = z.object({
  enabled: z.boolean().default(false),
  allow_screenshot: z.boolean().default(false),
  allow_uia_tree: z.boolean().default(false),
  allow_mouse: z.boolean().default(false),
  allow_keyboard: z.boolean().default(false),
  allow_clipboard: z.boolean().default(false),
  allow_window_management: z.boolean().default(false),
  allow_app_launch: z.boolean().default(false),
  allow_process_attach: z.boolean().default(false),
  allow_native_event_observer: z.boolean().default(false),
  allow_multi_monitor: z.boolean().default(true)
}).prefault({});

export const API_SET_NAMES = ['workspace', 'browser', 'computer', 'computer_windows', 'machine_admin', 'estate_admin'] as const;

export const apiSetsSchema = z.object({
  workspace: z.boolean().optional(),
  browser: z.boolean().optional(),
  computer: z.boolean().optional(),
  computer_windows: z.boolean().optional(),
  machine_admin: z.boolean().optional(),
  estate_admin: z.boolean().optional()
}).default({});

export const commandRuntimeSchema = z.object({
  preferred_shell: z.string().min(1).default('platform-default'),
  shell: z.object({
    command: z.string().min(1),
    args: z.array(z.string()).default([])
  }).optional()
}).prefault({});

export const filesystemScopeSchema = z.object({
  machine_admin_host_scope: z.boolean().optional(),
  host_root: z.string().min(1).default('/')
}).default({ host_root: '/' });

export const otaMemorySchema = z.object({
  enabled: z.boolean().default(false),
  python_executable: z.string().min(1).default('python'),
  package_root: z.string().min(1).optional(),
  database_path: z.string().min(1).optional(),
  fixture_handles_file: z.string().min(1).optional(),
  project_id: z.string().min(1).optional(),
  workspace_id: z.string().min(1).optional(),
  agent_id: z.string().min(1).optional(),
  user_id: z.string().default(''),
  scope_type: z.string().min(1).default('project'),
  privacy: z.string().min(1).default('project_only'),
  timeout_ms: z.number().int().min(1000).max(120000).default(30000)
}).superRefine((value, context) => {
  if (!value.enabled) return;
  for (const key of ['package_root', 'database_path', 'project_id'] as const) {
    if (!value[key]) context.addIssue({ code: 'custom', path: [key], message: `${key} is required when ota_memory is enabled` });
  }
}).prefault({});

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
  windows_computer: windowsComputerSchema,
  commands: z.record(z.string(), z.string()).default({}),
  filesystem: filesystemScopeSchema,
  ota_memory: otaMemorySchema,
  git: z.object({
    github_token_file: z.string().min(1).optional(),
    github_cli_wrapper: z.string().min(1).optional(),
    github_cli: z.string().min(1).default('gh'),
    git_cli: z.string().min(1).default('git'),
    user_name: z.string().min(1).optional(),
    user_email: z.string().email().optional()
  }).prefault({})
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
  if (sets.browser || sets.computer || sets.computer_windows) {
    next.allow_screen = true;
    next.allow_mouse_keyboard = true;
  }
  if (sets.computer_windows) {
    next.windows_computer = {
      ...next.windows_computer,
      enabled: true,
      allow_screenshot: true,
      allow_uia_tree: true,
      allow_mouse: true,
      allow_keyboard: true,
      allow_clipboard: true,
      allow_window_management: true,
      allow_app_launch: true,
      allow_process_attach: true,
      allow_multi_monitor: true
    };
  }
  if (sets.machine_admin) {
    next.allow_tests = true;
    next.filesystem = {
      ...next.filesystem,
      machine_admin_host_scope: next.filesystem.machine_admin_host_scope ?? true
    };
  }
  return next;
});

const misuseReportingSchema = z.object({
  enabled: z.boolean().default(true),
  central_url: z.string().url().optional(),
  local_jsonl_path: z.string().min(1).optional(),
  bearer_token_env: z.string().min(1).optional(),
  bearer_token_file: z.string().min(1).optional(),
  timeout_ms: z.number().int().positive().default(1500)
}).optional();

export const authSchema = z.object({
  enabled: z.boolean().default(false),
  bearer_token_env: z.string().min(1).default('OTA_GATEWAY_BEARER_TOKEN'),
  allow_loopback_without_auth: z.boolean().default(false)
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
  command_runtime: commandRuntimeSchema,
  misuse_reporting: misuseReportingSchema,
  brokered_executors: brokeredExecutorsConfigSchema,
  security: z.object({
    // Calvin policy: do not add hidden path/secret deny config to OTA/Threaddex.
    // These gateways must not become weaker than OpenClaw by blocking secrets, PATs,
    // credential paths, env files, or other local files that the configured workspace can access.
    // Any future deny/rejection field requires Calvin's explicit approval.
    max_file_bytes: z.number().int().positive().default(200000),
    max_response_bytes: z.number().int().positive().default(50000),
    max_request_bytes: z.number().int().positive().default(1000000),
    max_search_results: z.number().int().positive().default(50),
    max_exec_ms: z.number().int().positive().default(120000),
    // Provider compatibility/sanitization controls. All default off by policy.
    // conservative_censoring is an umbrella for lower-trust lanes and enables every
    // restrictive content/result/environment behavior below.
    conservative_censoring: z.boolean().optional(),
    secret_value_redaction: z.boolean().optional(),
    result_sanitization: z.boolean().optional(),
    secret_content_heuristics: z.boolean().optional(),
    environment_filtering: z.boolean().optional(),
    max_process_ms: z.number().int().positive().optional()
  }).prefault({})
});

export type AppConfig = z.infer<typeof configSchema>;
export type WorkspaceConfig = z.infer<typeof workspaceSchema>;

export function configuredMaxProcessMs(config: AppConfig): number {
  return config.security?.max_process_ms ?? DEFAULT_MAX_PROCESS_MS;
}

export function conservativeCensoringEnabled(config: AppConfig): boolean {
  return config.security?.conservative_censoring === true;
}

export function secretValueRedactionEnabled(config: AppConfig): boolean {
  return conservativeCensoringEnabled(config) || config.security?.secret_value_redaction === true;
}

export function resultSanitizationEnabled(config: AppConfig): boolean {
  return conservativeCensoringEnabled(config) || config.security?.result_sanitization === true;
}

export function secretContentHeuristicsEnabled(config: AppConfig): boolean {
  return conservativeCensoringEnabled(config) || config.security?.secret_content_heuristics === true;
}

export function environmentFilteringEnabled(config: AppConfig): boolean {
  return conservativeCensoringEnabled(config) || config.security?.environment_filtering === true;
}
