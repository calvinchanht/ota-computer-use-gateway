import { z } from 'zod';
import { runWorkspaceTool } from '../../core/toolRunner.js';
import { READ_ONLY, RUN_LOCAL, TOOL_RESULT_OUTPUT_SCHEMA } from './annotations.js';
import { workspaceHelperList, workspaceHelperRun, workspaceHelperStatus, workspaceHelperUpsert } from '../../tools/workspaceHelpers.js';
import type { RegisterContext } from './types.js';

const helperIdSchema = z.string().regex(/^[a-z][a-z0-9_]{1,63}$/);
const modeSchema = z.string().regex(/^[a-z][a-z0-9_]{1,31}$/);

export function registerWorkspaceHelperTools(context: RegisterContext): void {
  const { server, config, workspaces } = context;
  server.registerTool('workspace_helper_list', helperListTool(), async (args) => runWorkspaceTool(
    workspaces, args.workspace_id, 'workspace_helper_list',
    (workspace) => workspaceHelperList(config, workspace)
  ));
  server.registerTool('workspace_helper_status', helperStatusTool(), async (args) => runWorkspaceTool(
    workspaces, args.workspace_id, 'workspace_helper_status',
    (workspace) => workspaceHelperStatus(config, workspace, args.helper_id, args.mode)
  ));
  server.registerTool('workspace_helper_upsert', helperUpsertTool(), async (args) => runWorkspaceTool(
    workspaces, args.workspace_id, 'workspace_helper_upsert',
    (workspace) => workspaceHelperUpsert(config, workspace, args.definition)
  ));
  server.registerTool('workspace_helper_run', helperRunTool(), async (args) => runWorkspaceTool(
    workspaces, args.workspace_id, 'workspace_helper_run',
    (workspace) => workspaceHelperRun(config, workspace, args.helper_id, args.mode, args.args)
  ));
}

function helperListTool() {
  return {
    title: 'Workspace helper list',
    description: 'List server-approved workspace helpers from the local helper registry. Read-only: returns helper ids, modes, template kinds, and bounded metadata only.',
    inputSchema: { workspace_id: z.string() },
    outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: READ_ONLY
  };
}

function helperStatusTool() {
  return {
    title: 'Workspace helper status',
    description: 'Return one server-approved workspace helper definition by helper_id and optional mode. Read-only and bounded.',
    inputSchema: { workspace_id: z.string(), helper_id: helperIdSchema, mode: modeSchema.optional() },
    outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: READ_ONLY
  };
}

function helperUpsertTool() {
  return {
    title: 'Workspace helper upsert',
    description: 'Create or update one workspace helper definition from constrained template fields. This does not accept arbitrary shell code, arbitrary script paths, or user-supplied executable text. The server validates helper_id, mode, template kind, repo, host, service, local checks, output bounds, audit context, workspace scope, and secret redaction boundaries.',
    inputSchema: {
      workspace_id: z.string(),
      definition: z.object({
        helper_id: helperIdSchema,
        mode: modeSchema,
        kind: z.enum(['repo_build_test', 'host_health_check', 'ssh_systemd_user_service', 'repo_deploy_to_host', 'threaddex_agent_smoke']),
        description: z.string().max(500).optional(),
        repo: z.string().regex(/^[A-Za-z0-9._/-]{1,160}$/).optional(),
        checks: z.array(z.enum(['build', 'test', 'style', 'check'])).default([]),
        target_host_id: z.string().regex(/^[a-z][a-z0-9_-]{1,63}$/).optional(),
        target_user: z.string().regex(/^[a-z_][a-z0-9_-]{0,31}$/).optional(),
        service_unit: z.string().regex(/^[A-Za-z0-9_.@:-]{1,160}\.service$/).optional(),
        post_checks: z.array(z.object({
          kind: z.enum(['http_json', 'command_status']),
          url: z.string().optional(),
          expect_status: z.number().int().positive().optional()
        }).strict()).default([])
      }).strict()
    },
    outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: RUN_LOCAL
  };
}

function helperRunTool() {
  return {
    title: 'Workspace helper run',
    description: 'Run one server-approved workspace helper by helper_id and mode. Helpers are selected from a fixed local registry with constrained template kinds and schemas. This tool cannot run arbitrary commands, arbitrary file paths, or user-supplied scripts. It is for bounded maintenance of the user-owned authenticated workspace and assigned hosts, with bounded output and secret redaction.',
    inputSchema: { workspace_id: z.string(), helper_id: helperIdSchema, mode: modeSchema, args: z.record(z.string(), z.unknown()).default({}) },
    outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: RUN_LOCAL
  };
}
