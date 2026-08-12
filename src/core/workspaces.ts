import { lstat, mkdir, realpath } from 'node:fs/promises';
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
  const requestedAgentDir = workspace.agent_dir
    ? (path.isAbsolute(workspace.agent_dir) ? path.resolve(workspace.agent_dir) : path.resolve(realRoot, workspace.agent_dir))
    : path.join(realRoot, '.agent');
  const realAgentDir = await ensureWorkspaceAgentDir(realRoot, requestedAgentDir);
  return { ...workspace, realRoot, realAgentDir };
}

async function ensureWorkspaceAgentDir(realRoot: string, requested: string): Promise<string> {
  const relative = path.relative(realRoot, requested);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('workspace agent_dir must be a directory inside the workspace root');
  let current = realRoot;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    const next = path.join(current, segment);
    let info;
    try { info = await lstat(next); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      await mkdir(next, { mode: 0o700 });
      info = await lstat(next);
    }
    if (info.isSymbolicLink()) throw new Error('workspace agent_dir must not contain symlinks');
    if (!info.isDirectory()) throw new Error('workspace agent_dir must contain directories only');
    const resolved = await realpath(next);
    if (!pathInside(realRoot, resolved)) throw new Error('workspace agent_dir resolves outside the workspace root');
    current = resolved;
  }
  return current;
}

function pathInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}

export function getWorkspace(workspaces: Map<string, Workspace>, id: string): Workspace {
  const workspace = workspaces.get(id);
  if (!workspace) throw new Error(`unknown workspace: ${id}`);
  return workspace;
}
