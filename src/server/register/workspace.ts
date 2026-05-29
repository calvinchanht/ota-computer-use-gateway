import { z } from 'zod';
import { asText, fail } from '../../core/result.js';
import { getWorkspace } from '../../core/workspaces.js';
import { heartbeat } from '../../tools/heartbeat.js';
import { workspacePolicy } from '../../tools/policy.js';
import { toolProfile } from '../../tools/toolProfile.js';
import { workspaceStatus } from '../../tools/workspace.js';
import { READ_ONLY } from './annotations.js';
import type { RegisterContext, WorkspaceMap } from './types.js';

export function registerWorkspaceTools({ server, workspaces }: RegisterContext): void {
  server.registerTool('workspace_status', {
    title: 'Workspace status',
    description: 'List configured workspaces, capabilities, and command ids.',
    inputSchema: {},
    annotations: READ_ONLY
  }, async () => asText(workspaceStatus(workspaces)));

  server.registerTool('heartbeat', {
    title: 'Heartbeat',
    description: 'Report local agent availability.',
    annotations: READ_ONLY
  }, async () => asText(heartbeat(workspaces)));

  server.registerTool('get_workspace_policy', {
    title: 'Get workspace policy',
    description: 'Return allowed tools and policy for a workspace.',
    inputSchema: { workspace_id: z.string() },
    annotations: READ_ONLY
  }, async ({ workspace_id }) => safePolicy(workspaces, workspace_id));

  server.registerTool('get_tool_profile', {
    title: 'Get tool profile',
    description: 'Return canonical tool naming, aliases, deprecated names, and context conventions.',
    inputSchema: {},
    annotations: READ_ONLY
  }, async () => asText(toolProfile()));
}

function safePolicy(workspaces: WorkspaceMap, workspaceId: string) {
  try { return asText(workspacePolicy(getWorkspace(workspaces, workspaceId))); }
  catch (error) { return asText(fail(error instanceof Error ? error.message : String(error))); }
}
