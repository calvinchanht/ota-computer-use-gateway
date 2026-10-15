import { audit, toolAuditMetadata } from './audit.js';
import { asText, fail, type ToolResult } from './result.js';
import { assertNotStopped } from './panic.js';
import { getWorkspace, type Workspace } from './workspaces.js';

export type WorkspaceMap = Map<string, Workspace>;
export type ToolFn = (workspace: Workspace) => Promise<ToolResult>;
export type AuditInvocation = unknown | ((workspace: Workspace) => unknown);

export async function runWorkspaceTool(workspaces: WorkspaceMap, workspaceId: string, tool: string, fn: ToolFn, auditInvocation?: AuditInvocation) {
  const started = Date.now();
  let workspace: Workspace | null = null;
  let invocation: unknown;
  try {
    workspace = getWorkspace(workspaces, workspaceId);
    await assertNotStopped(workspace, tool);
    invocation = typeof auditInvocation === 'function' ? auditInvocation(workspace) : auditInvocation;
    const result = await fn(workspace);
    await record(workspace, tool, result, started, invocation);
    return asText(result);
  } catch (error) {
    const summary = error instanceof Error ? error.message : String(error);
    await record(workspace, tool, fail(summary), started, invocation);
    return asText(fail(summary));
  }
}

async function record(workspace: Workspace | null, tool: string, result: ToolResult, started: number, invocation?: unknown) {
  await audit(workspace, {
    timestamp: new Date().toISOString(),
    tool,
    ok: result.ok,
    summary: result.summary,
    duration_ms: Date.now() - started,
    metadata: toolAuditMetadata(tool, result.data, undefined, invocation)
  });
}
