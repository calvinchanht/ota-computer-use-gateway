import { readFile, writeFile } from 'node:fs/promises';
import { agentPath, ensureAgentDir } from './agentDir.js';
import { safeJsonParse } from './json.js';
import type { Workspace } from './workspaces.js';

export type Approval = { id: string; action: string; created_at: string; approved_by?: string; expires_at?: string };

export async function listApprovals(workspace: Workspace): Promise<Approval[]> {
  try { return safeJsonParse<Approval[]>(await readFile(filePath(workspace), 'utf8'), []); }
  catch { return []; }
}

export async function recordApproval(workspace: Workspace, approval: Approval): Promise<void> {
  await ensureAgentDir(workspace);
  const approvals = await listApprovals(workspace);
  approvals.push(approval);
  await writeFile(filePath(workspace), JSON.stringify(approvals, null, 2) + '\n');
}

export async function hasApproval(workspace: Workspace, action: string): Promise<boolean> {
  const now = Date.now();
  const approvals = await listApprovals(workspace);
  return approvals.some((item) => item.action === action && !expired(item, now));
}

function expired(approval: Approval, now: number): boolean {
  return approval.expires_at ? Date.parse(approval.expires_at) <= now : false;
}

function filePath(workspace: Workspace): string {
  return agentPath(workspace, 'approvals.json');
}
