import { mkdir, appendFile } from 'node:fs/promises';
import path from 'node:path';
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
  const dir = path.join(workspace.realAgentDir ?? path.join(workspace.realRoot, '.agent'), 'audit');
  await mkdir(dir, { recursive: true });
  await appendFile(path.join(dir, 'tool_calls.jsonl'), JSON.stringify(entry) + '\n');
}
