import { audit, toolAuditMetadata } from './audit.js';
import { asText, fail, type ToolResult } from './result.js';
import { assertNotStopped } from './panic.js';
import { getWorkspace, type Workspace } from './workspaces.js';

export type WorkspaceMap = Map<string, Workspace>;
export type ToolFn = (workspace: Workspace) => Promise<ToolResult>;

export async function runWorkspaceTool(workspaces: WorkspaceMap, workspaceId: string, tool: string, fn: ToolFn) {
  const started = Date.now();
  let workspace: Workspace | null = null;
  try {
    workspace = getWorkspace(workspaces, workspaceId);
    await assertNotStopped(workspace, tool);
    const result = await fn(workspace);
    await record(workspace, tool, result, started);
    return asText(result);
  } catch (error) {
    const summary = error instanceof Error ? error.message : String(error);
    await record(workspace, tool, fail(summary), started);
    return asText(fail(summary));
  }
}

async function record(workspace: Workspace | null, tool: string, result: ToolResult, started: number) {
  await audit(workspace, {
    timestamp: new Date().toISOString(),
    tool,
    ok: result.ok,
    summary: result.summary,
    duration_ms: Date.now() - started,
    metadata: toolAuditMetadata(tool, result.data)
  });
}
