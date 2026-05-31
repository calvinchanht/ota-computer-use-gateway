import { z } from 'zod';
import { asText, fail, ok, type ToolResult } from '../../core/result.js';
import { runWorkspaceTool } from '../../core/toolRunner.js';
import { getWorkspace } from '../../core/workspaces.js';
import { heartbeat } from '../../tools/heartbeat.js';
import { listDir, readFileTool } from '../../tools/files.js';
import { gitDiff, gitStatus } from '../../tools/git.js';
import { workspaceStatus } from '../../tools/workspace.js';
import { READ_ONLY, TOOL_RESULT_OUTPUT_SCHEMA } from './annotations.js';
import type { RegisterContext, WorkspaceMap } from './types.js';

const threadSchema = z.object({
  provider: z.string().default('chatgpt'),
  project_id: z.string().optional(),
  thread_id: z.string().optional(),
  thread_url: z.string().optional(),
  client_session_id: z.string().optional()
}).passthrough().optional();

const gatewayRequestSchema = {
  thread: threadSchema,
  tool: z.enum(['heartbeat', 'workspace_status', 'list_dir', 'read_file', 'git_status', 'git_diff']),
  arguments: z.record(z.string(), z.unknown()).default({}),
  idempotency_key: z.string().optional()
};

const gatewayBatchSchema = {
  thread: threadSchema,
  steps: z.array(z.object({
    tool: z.enum(['heartbeat', 'workspace_status', 'list_dir', 'read_file', 'git_status', 'git_diff']),
    arguments: z.record(z.string(), z.unknown()).default({})
  })).max(20),
  idempotency_key: z.string().optional()
};

export function registerGatewayTools(context: RegisterContext): void {
  context.server.registerTool('gateway_request', {
    title: 'Gateway request',
    description: 'Call one scoped gateway capability through a small provider-friendly API shim. Use this instead of many individual tools when available.',
    inputSchema: gatewayRequestSchema,
    outputSchema: TOOL_RESULT_OUTPUT_SCHEMA,
    annotations: READ_ONLY
  }, async (args) => asText(await gatewayRequest(context, args.tool, args.arguments, args.thread)));

  context.server.registerTool('gateway_batch', {
    title: 'Gateway batch',
    description: 'Call several scoped gateway capabilities sequentially through one provider-friendly API shim request.',
    inputSchema: gatewayBatchSchema,
    outputSchema: TOOL_RESULT_OUTPUT_SCHEMA,
    annotations: READ_ONLY
  }, async (args) => asText(await gatewayBatch(context, args.steps, args.thread)));
}

async function gatewayBatch(context: RegisterContext, steps: Array<{ tool: string; arguments: Record<string, unknown> }>, thread: unknown): Promise<ToolResult> {
  const results = [];
  for (let index = 0; index < steps.length; index++) {
    const step = steps[index];
    results.push({ index, tool: step.tool, result: await gatewayRequest(context, step.tool, step.arguments, thread) });
  }
  return ok(`completed ${results.length} gateway batch steps`, { thread, results });
}

async function gatewayRequest(context: RegisterContext, tool: string, args: Record<string, unknown>, thread: unknown): Promise<ToolResult> {
  try {
    const result = await callGatewayTool(context, tool, args);
    return ok(result.summary, { thread, tool, result });
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}

async function callGatewayTool({ config, workspaces }: RegisterContext, tool: string, args: Record<string, unknown>): Promise<ToolResult> {
  if (tool === 'heartbeat') return heartbeat(workspaces);
  if (tool === 'workspace_status') return workspaceStatus(workspaces);

  const workspaceId = workspaceIdArg(workspaces, args.workspace_id);
  const result = await runWorkspaceTool(workspaces, workspaceId, tool, async (workspace) => {
    if (tool === 'list_dir') return listDir(config, workspace, stringArg(args.path, '.'), numberArg(args.max_entries));
    if (tool === 'read_file') return readFileTool(config, workspace, requiredStringArg(args.path, 'path'), numberArg(args.start_line), numberArg(args.max_lines));
    if (tool === 'git_status') return gitStatus(workspace);
    if (tool === 'git_diff') return gitDiff(workspace, numberArg(args.max_bytes) ?? 20000);
    throw new Error(`unsupported gateway tool: ${tool}`);
  });
  return result.structuredContent as ToolResult;
}

function workspaceIdArg(workspaces: WorkspaceMap, value: unknown): string {
  if (typeof value === 'string' && value) return getWorkspace(workspaces, value).id;
  if (workspaces.size === 1) return [...workspaces.keys()][0];
  throw new Error('workspace_id is required');
}

function requiredStringArg(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value) throw new Error(`${name} is required`);
  return value;
}

function stringArg(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function numberArg(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
