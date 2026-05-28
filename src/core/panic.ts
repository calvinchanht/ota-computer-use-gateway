import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { agentPath } from './agentDir.js';
import type { Workspace } from './workspaces.js';

const ALLOWED_WHEN_STOPPED = new Set(['heartbeat', 'get_workspace_policy']);

export async function panicStopped(workspace: Workspace): Promise<boolean> {
  try {
    await access(agentPath(workspace, 'PANIC_STOP'), constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function assertNotStopped(workspace: Workspace, tool: string): Promise<void> {
  if (ALLOWED_WHEN_STOPPED.has(tool)) return;
  if (await panicStopped(workspace)) throw new Error('workspace panic stop is active');
}
