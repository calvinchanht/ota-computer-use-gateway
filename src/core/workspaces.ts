import { realpath } from 'node:fs/promises';
import path from 'node:path';
import type { AppConfig, WorkspaceConfig } from '../config/schema.js';

export type Workspace = Omit<WorkspaceConfig, 'api_sets'> & { api_sets?: WorkspaceConfig['api_sets']; realRoot: string; realAgentDir: string };

export async function buildWorkspaces(config: AppConfig): Promise<Map<string, Workspace>> {
  const entries = await Promise.all(config.workspaces.map(resolveWorkspace));
  return new Map(entries.map((item) => [item.id, item]));
}

async function resolveWorkspace(workspace: WorkspaceConfig): Promise<Workspace> {
  if (!path.isAbsolute(workspace.root)) throw new Error(`workspace root must be absolute: ${workspace.id}`);
  const realRoot = await realpath(workspace.root);
  const realAgentDir = workspace.agent_dir ? path.resolve(workspace.agent_dir) : path.join(realRoot, '.agent');
  return { ...workspace, realRoot, realAgentDir };
}

export function getWorkspace(workspaces: Map<string, Workspace>, id: string): Workspace {
  const workspace = workspaces.get(id);
  if (!workspace) throw new Error(`unknown workspace: ${id}`);
  return workspace;
}
