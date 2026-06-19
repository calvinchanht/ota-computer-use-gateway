import { z } from 'zod';
import { runWorkspaceTool } from '../../core/toolRunner.js';
import { gitDiff, gitPushCurrentBranch, gitStatus } from '../../tools/git.js';
import { githubCliTool } from '../../tools/github.js';
import { READ_ONLY, RUN_LOCAL, TOOL_RESULT_OUTPUT_SCHEMA } from './annotations.js';
import type { RegisterContext } from './types.js';

export function registerGitTools({ server, config, workspaces }: RegisterContext): void {
  server.registerTool('github', githubTool(), async (args) => runWorkspaceTool(
    workspaces, args.workspace_id, 'github',
    (workspace) => githubCliTool(config, workspace, args.cmd_array, args.cwd, args.timeout_ms, args.max_output_chars)
  ));
  server.registerTool('git_status', { title: 'Git status', description: 'Return concise git status.', inputSchema: { workspace_id: z.string() }, outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: READ_ONLY }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'git_status', gitStatus));
  server.registerTool('git_diff', { title: 'Git diff', description: 'Return bounded git diff.', inputSchema: { workspace_id: z.string(), max_bytes: z.number().optional() }, outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: READ_ONLY }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'git_diff', (workspace) => gitDiff(workspace, args.max_bytes)));
  server.registerTool('git_push_current_branch', { title: 'Git push current branch', description: 'Push the current git branch from a repo path using configured local credentials without exposing token material.', inputSchema: { workspace_id: z.string(), repo_path: z.string().default('.'), remote: z.string().default('origin'), branch: z.string().optional() }, outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: RUN_LOCAL }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'git_push_current_branch', (workspace) => gitPushCurrentBranch(config, workspace, args.repo_path, args.remote, args.branch)));
}

function githubTool() {
  return {
    title: 'GitHub CLI',
    description: 'Run GitHub CLI argv through the configured PAT-backed lane; cmd_array starts after gh.',
    inputSchema: {
      workspace_id: z.string(),
      cmd_array: z.array(z.string()).min(1),
      cwd: z.string().default('.'),
      timeout_ms: z.number().default(60000),
      max_output_chars: z.number().default(20000)
    },
    outputSchema: TOOL_RESULT_OUTPUT_SCHEMA,
    annotations: RUN_LOCAL
  };
}
