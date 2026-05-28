import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AppConfig } from '../config/schema.js';
import { asText, fail } from '../core/result.js';
import { getWorkspace, type Workspace } from '../core/workspaces.js';
import { runWorkspaceTool } from '../core/toolRunner.js';
import { applyPatch } from '../tools/applyPatch.js';
import { createLocalApproval, approvalStatus } from '../tools/approval.js';
import { listDir, readFileTool } from '../tools/files.js';
import { gitDiff, gitStatus } from '../tools/git.js';
import { heartbeat } from '../tools/heartbeat.js';
import { getProjectContext, memorySearch, memoryWrite } from '../tools/memory.js';
import { proposePatch } from '../tools/patch.js';
import { workspacePolicy } from '../tools/policy.js';
import { searchFiles } from '../tools/search.js';

export type WorkspaceMap = Map<string, Workspace>;

export function registerTools(server: McpServer, config: AppConfig, workspaces: WorkspaceMap): void {
  registerBase(server, workspaces);
  registerFileTools(server, config, workspaces);
  registerGitTools(server, workspaces);
  registerMemoryTools(server, workspaces);
  registerPatchTools(server, config, workspaces);
  registerApprovalTools(server, workspaces);
}

function registerBase(server: McpServer, workspaces: WorkspaceMap): void {
  server.registerTool('heartbeat', { description: 'Report local agent availability.' }, async () => asText(heartbeat(workspaces)));
  server.registerTool('get_workspace_policy', {
    description: 'Return allowed tools and policy for a workspace.',
    inputSchema: { workspace_id: z.string() }
  }, async ({ workspace_id }) => safePolicy(workspaces, workspace_id));
}

function registerFileTools(server: McpServer, config: AppConfig, workspaces: WorkspaceMap): void {
  server.registerTool('list_dir', { description: 'List files in a workspace directory.', inputSchema: { workspace_id: z.string(), path: z.string().default('.'), max_entries: z.number().optional() } }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'list_dir', (workspace) => listDir(config, workspace, args.path, args.max_entries)));
  server.registerTool('read_file', { description: 'Read a text file inside a workspace.', inputSchema: { workspace_id: z.string(), path: z.string(), start_line: z.number().optional(), max_lines: z.number().optional() } }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'read_file', (workspace) => readFileTool(config, workspace, args.path, args.start_line, args.max_lines)));
  server.registerTool('search_files', { description: 'Search text in workspace files.', inputSchema: { workspace_id: z.string(), query: z.string(), path: z.string().default('.') } }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'search_files', (workspace) => searchFiles(config, workspace, args.query, args.path)));
}

function registerGitTools(server: McpServer, workspaces: WorkspaceMap): void {
  server.registerTool('git_status', { description: 'Return concise git status.', inputSchema: { workspace_id: z.string() } }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'git_status', gitStatus));
  server.registerTool('git_diff', { description: 'Return bounded git diff.', inputSchema: { workspace_id: z.string(), max_bytes: z.number().optional() } }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'git_diff', (workspace) => gitDiff(workspace, args.max_bytes)));
}

function registerMemoryTools(server: McpServer, workspaces: WorkspaceMap): void {
  server.registerTool('memory_search', { description: 'Search project-local memory files.', inputSchema: { workspace_id: z.string(), query: z.string(), max_results: z.number().optional() } }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'memory_search', (workspace) => memorySearch(workspace, args.query, args.max_results)));
  server.registerTool('memory_write', { description: 'Append a project-local memory entry after secret checks.', inputSchema: { workspace_id: z.string(), type: z.string(), title: z.string(), body: z.string(), tags: z.array(z.string()).optional() } }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'memory_write', (workspace) => memoryWrite(workspace, args.type, args.title, args.body, args.tags)));
  server.registerTool('get_project_context', { description: 'Return compact project context files from .agent.', inputSchema: { workspace_id: z.string() } }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'get_project_context', getProjectContext));
}

function registerPatchTools(server: McpServer, config: AppConfig, workspaces: WorkspaceMap): void {
  const changes = z.array(z.object({ path: z.string(), old_text: z.string(), new_text: z.string() }));
  server.registerTool('propose_patch', { description: 'Store a patch proposal without modifying project files.', inputSchema: { workspace_id: z.string(), reason: z.string(), changes } }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'propose_patch', (workspace) => proposePatch(config, workspace, args.changes, args.reason)));
  server.registerTool('apply_patch', { description: 'Apply exact-text replacements after local approval.', inputSchema: { workspace_id: z.string(), approval_action: z.string().default('apply_patch'), changes } }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'apply_patch', (workspace) => applyPatch(config, workspace, args.changes, args.approval_action)));
}


function registerApprovalTools(server: McpServer, workspaces: WorkspaceMap): void {
  server.registerTool('approval_status', { description: 'List local workspace approvals.', inputSchema: { workspace_id: z.string() } }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'approval_status', approvalStatus));
  server.registerTool('create_local_approval', { description: 'Record a local approval marker for development/testing.', inputSchema: { workspace_id: z.string(), action: z.string(), approved_by: z.string().optional() } }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'create_local_approval', (workspace) => createLocalApproval(workspace, args.action, args.approved_by)));
}

function safePolicy(workspaces: WorkspaceMap, workspaceId: string) {
  try { return asText(workspacePolicy(getWorkspace(workspaces, workspaceId))); }
  catch (error) { return asText(fail(error instanceof Error ? error.message : String(error))); }
}
