import { mkdir, appendFile } from 'node:fs/promises';
import { agentPath } from './agentDir.js';
import type { Workspace } from './workspaces.js';

export type AuditEntry = {
  timestamp: string;
  tool: string;
  workspace_id?: string;
  ok: boolean;
  summary: string;
  duration_ms: number;
};

export async function audit(workspace: Workspace | null, entry: AuditEntry): Promise<void> {
  if (!workspace) return;
  const dir = agentPath(workspace, 'audit');
  await mkdir(dir, { recursive: true });
  await appendFile(agentPath(workspace, 'audit', 'tool_calls.jsonl'), JSON.stringify(entry) + '\n');
}
