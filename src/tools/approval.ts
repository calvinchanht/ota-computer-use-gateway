import { hasApproval, listApprovals, recordApproval } from '../core/approval.js';
import { ok } from '../core/result.js';
import type { Workspace } from '../core/workspaces.js';

export async function approvalStatus(workspace: Workspace) {
  return ok('approval status', { approvals: await listApprovals(workspace) });
}

export async function createLocalApproval(workspace: Workspace, action: string, approvedBy = 'local') {
  const id = `approval_${new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14)}`;
  await recordApproval(workspace, { id, action, approved_by: approvedBy, created_at: new Date().toISOString() });
  return ok('local approval recorded', { id, action });
}

export async function requireApproval(workspace: Workspace, action: string): Promise<void> {
  if (!(await hasApproval(workspace, action))) throw new Error(`missing approval for ${action}`);
}
