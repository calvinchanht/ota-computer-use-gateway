import { mkdir, readFile, appendFile } from 'node:fs/promises';
import path from 'node:path';
import type { Workspace } from './workspaces.js';

export function agentPath(workspace: Workspace, ...parts: string[]): string {
  return path.join(workspace.realRoot, '.agent', ...parts);
}

export async function ensureAgentDir(workspace: Workspace): Promise<void> {
  await mkdir(agentPath(workspace, 'audit'), { recursive: true });
  await mkdir(agentPath(workspace, 'patches'), { recursive: true });
}

export async function readAgentFile(workspace: Workspace, name: string): Promise<string> {
  try { return await readFile(agentPath(workspace, name), 'utf8'); } catch { return ''; }
}

export async function appendMemory(workspace: Workspace, entry: unknown): Promise<void> {
  await ensureAgentDir(workspace);
  await appendFile(agentPath(workspace, 'MEMORY_LOG.jsonl'), JSON.stringify(entry) + '\n');
}
