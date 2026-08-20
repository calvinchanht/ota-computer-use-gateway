import { z } from 'zod';
import { runWorkspaceTool } from '../../core/toolRunner.js';
import { gitCliTool, gitDiff, gitLfsPublishCurrentBranch, gitPushCurrentBranch, gitStatus } from '../../tools/git.js';
import { githubCliTool } from '../../tools/github.js';
import { READ_ONLY, RUN_LOCAL, TOOL_RESULT_OUTPUT_SCHEMA } from './annotations.js';
import type { RegisterContext } from './types.js';

export function registerGitTools({ server, config, workspaces }: RegisterContext): void {
  server.registerTool('git', gitTool(), async (args) => runWorkspaceTool(
    workspaces, args.workspace_id, 'git',
    (workspace) => gitCliTool(config, workspace, args.cmd_array, args.cwd, args.timeout_ms, args.max_output_chars)
  ));
  server.registerTool('github', githubTool(), async (args) => runWorkspaceTool(
    workspaces, args.workspace_id, 'github',
    (workspace) => githubCliTool(config, workspace, args.cmd_array, args.cwd, args.timeout_ms, args.max_output_chars, args.rate_policy)
  ));
  server.registerTool('git_status', { title: 'Git status', description: 'Return concise git status.', inputSchema: { workspace_id: z.string() }, outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: READ_ONLY }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'git_status', (workspace) => gitStatus(config, workspace)));
  server.registerTool('git_diff', { title: 'Git diff', description: 'Return bounded git diff.', inputSchema: { workspace_id: z.string(), max_bytes: z.number().optional() }, outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: READ_ONLY }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'git_diff', (workspace) => gitDiff(config, workspace, args.max_bytes)));
  server.registerTool('git_push_current_branch', { title: 'Git push current branch', description: 'Publish the current branch using configured credentials. Automatically initializes and uploads Git LFS content when the repository uses LFS.', inputSchema: { workspace_id: z.string(), repo_path: z.string().default('.'), remote: z.string().default('origin'), branch: z.string().optional() }, outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: RUN_LOCAL }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'git_push_current_branch', (workspace) => gitPushCurrentBranch(config, workspace, args.repo_path, args.remote, args.branch)));
  server.registerTool('git_lfs_publish_current_branch', {
    title: 'Git LFS publish current branch',
    description: 'Verify Git LFS pointers and objects, upload required LFS objects, then push the current branch. Optional force_with_lease_sha must be the exact expected remote SHA.',
    inputSchema: { workspace_id: z.string(), repo_path: z.string().default('.'), remote: z.string().default('origin'), branch: z.string().optional(), force_with_lease_sha: z.string().regex(/^[0-9a-f]{40}$/i).optional() },
    outputSchema: TOOL_RESULT_OUTPUT_SCHEMA,
    annotations: RUN_LOCAL
  }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'git_lfs_publish_current_branch', (workspace) => gitLfsPublishCurrentBranch(config, workspace, args.repo_path, args.remote, args.branch, args.force_with_lease_sha)));
}

function gitTool() {
  return {
    title: 'Git',
    description: 'Run local Git argv, including Git LFS subcommands such as ["lfs","status"]. The configured workspace PAT is supplied automatically through ephemeral child-process Git config for GitHub network operations; cmd_array starts after git.',
    inputSchema: argvToolSchema(),
    outputSchema: TOOL_RESULT_OUTPUT_SCHEMA,
    annotations: RUN_LOCAL
  };
}

function githubTool() {
  return {
    title: 'GitHub CLI',
    description: 'Run GitHub CLI argv through the configured PAT-backed lane; cmd_array starts after gh. Optional rate_policy adds default-off rate-budget preflight and bounded safe-read retry handling.',
    inputSchema: {
      ...argvToolSchema(),
      rate_policy: z.object({
        preflight: z.boolean().optional(),
        resource: z.string().min(1).optional(),
        min_remaining: z.number().int().nonnegative().optional(),
        retry_mode: z.enum(['never', 'safe_read_once']).optional(),
        max_wait_ms: z.number().int().nonnegative().max(60000).optional()
      }).strict().optional()
    },
    outputSchema: TOOL_RESULT_OUTPUT_SCHEMA,
    annotations: RUN_LOCAL
  };
}

function argvToolSchema() {
  return {
    workspace_id: z.string(),
    cmd_array: z.array(z.string()).min(1),
    cwd: z.string().default('.'),
    timeout_ms: z.number().default(60000),
    max_output_chars: z.number().default(20000)
  };
}
