import { z } from 'zod';
import { runWorkspaceTool } from '../../core/toolRunner.js';
import { gitDiff, gitStatus } from '../../tools/git.js';
import { READ_ONLY, WRITE_FILE, RUN_LOCAL } from './annotations.js';
import type { RegisterContext } from './types.js';

export function registerGitTools({ server, workspaces }: RegisterContext): void {
  server.registerTool('git_status', { title: 'Git status', description: 'Return concise git status.', inputSchema: { workspace_id: z.string() }, annotations: READ_ONLY }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'git_status', gitStatus));
  server.registerTool('git_diff', { title: 'Git diff', description: 'Return bounded git diff.', inputSchema: { workspace_id: z.string(), max_bytes: z.number().optional() }, annotations: READ_ONLY }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'git_diff', (workspace) => gitDiff(workspace, args.max_bytes)));
}
