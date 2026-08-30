import { ensureAgentDir, readAgentFile } from '../core/agentDir.js';
import { ok } from '../core/result.js';
import type { Workspace } from '../core/workspaces.js';

export async function getProjectContext(workspace: Workspace) {
  await ensureAgentDir(workspace);
  const files = ['PROJECT_CONTEXT.md', 'CURRENT_TASK.md', 'DECISIONS.md'];
  const data = Object.fromEntries(await Promise.all(files.map(async (file) => [file, await readAgentFile(workspace, file)])));
  return ok('project context loaded', data);
}
