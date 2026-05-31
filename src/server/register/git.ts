import { z } from 'zod';
import { runWorkspaceTool } from '../../core/toolRunner.js';
import { gitDiff, gitPushCurrentBranch, gitStatus } from '../../tools/git.js';
import { READ_ONLY, WRITE_FILE, RUN_LOCAL, TOOL_RESULT_OUTPUT_SCHEMA } from './annotations.js';
import type { RegisterContext } from './types.js';

export function registerGitTools({ server, config, workspaces }: RegisterContext): void {
  server.registerTool('git_status', { title: 'Git status', description: 'Return concise git status.', inputSchema: { workspace_id: z.string() }, outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: READ_ONLY }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'git_status', gitStatus));
  server.registerTool('git_diff', { title: 'Git diff', description: 'Return bounded git diff.', inputSchema: { workspace_id: z.string(), max_bytes: z.number().optional() }, outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: READ_ONLY }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'git_diff', (workspace) => gitDiff(workspace, args.max_bytes)));
  server.registerTool('git_push_current_branch', { title: 'Git push current branch', description: 'Push the current git branch from a repo path using configured local credentials without exposing token material.', inputSchema: { workspace_id: z.string(), repo_path: z.string().default('.'), remote: z.string().default('origin'), branch: z.string().optional() }, outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: RUN_LOCAL }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'git_push_current_branch', (workspace) => gitPushCurrentBranch(config, workspace, args.repo_path, args.remote, args.branch)));
}
