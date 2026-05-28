import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { configPathFromArg, loadConfig } from './config/load.js';
import { asText, fail } from './core/result.js';
import { listDir, readFileTool } from './tools/files.js';
import { searchFiles } from './tools/search.js';
import { gitStatus, gitDiff } from './tools/git.js';
import { memorySearch, memoryWrite, getProjectContext } from './tools/memory.js';
import { buildWorkspaces, getWorkspace } from './core/workspaces.js';
import { heartbeat } from './tools/heartbeat.js';
import { workspacePolicy } from './tools/policy.js';

async function main(): Promise<void> {
  const config = await loadConfig(configPathFromArg(process.argv));
  const workspaces = await buildWorkspaces(config);
  const server = new McpServer({ name: 'gtp-local-mcp-agent', version: '0.1.0' });
  registerBaseTools(server, config, workspaces);
  await server.connect(new StdioServerTransport());
}

function registerBaseTools(server: McpServer, config: Awaited<ReturnType<typeof loadConfig>>, workspaces: Awaited<ReturnType<typeof buildWorkspaces>>): void {
  server.registerTool('heartbeat', { description: 'Report local agent availability.' }, async () => asText(heartbeat(workspaces)));
  server.registerTool('get_workspace_policy', {
    description: 'Return allowed tools and policy for a workspace.',
    inputSchema: { workspace_id: z.string() }
  }, async ({ workspace_id }) => safePolicy(workspaces, workspace_id));

  server.registerTool('list_dir', {
    description: 'List files in a workspace directory.',
    inputSchema: { workspace_id: z.string(), path: z.string().default('.'), max_entries: z.number().optional() }
  }, async (args) => safeWorkspaceTool(workspaces, args.workspace_id, (workspace) => listDir(config, workspace, args.path, args.max_entries)));
  server.registerTool('read_file', {
    description: 'Read a text file inside a workspace.',
    inputSchema: { workspace_id: z.string(), path: z.string(), start_line: z.number().optional(), max_lines: z.number().optional() }
  }, async (args) => safeWorkspaceTool(workspaces, args.workspace_id, (workspace) => readFileTool(config, workspace, args.path, args.start_line, args.max_lines)));
  server.registerTool('search_files', {
    description: 'Search text in workspace files.',
    inputSchema: { workspace_id: z.string(), query: z.string(), path: z.string().default('.') }
  }, async (args) => safeWorkspaceTool(workspaces, args.workspace_id, (workspace) => searchFiles(config, workspace, args.query, args.path)));
  server.registerTool('git_status', {
    description: 'Return concise git status.',
    inputSchema: { workspace_id: z.string() }
  }, async (args) => safeWorkspaceTool(workspaces, args.workspace_id, gitStatus));
  server.registerTool('git_diff', {
    description: 'Return bounded git diff.',
    inputSchema: { workspace_id: z.string(), max_bytes: z.number().optional() }
  }, async (args) => safeWorkspaceTool(workspaces, args.workspace_id, (workspace) => gitDiff(workspace, args.max_bytes)));

  server.registerTool('memory_search', {
    description: 'Search project-local memory files.',
    inputSchema: { workspace_id: z.string(), query: z.string(), max_results: z.number().optional() }
  }, async (args) => safeWorkspaceTool(workspaces, args.workspace_id, (workspace) => memorySearch(workspace, args.query, args.max_results)));
  server.registerTool('memory_write', {
    description: 'Append a project-local memory entry after secret checks.',
    inputSchema: { workspace_id: z.string(), type: z.string(), title: z.string(), body: z.string(), tags: z.array(z.string()).optional() }
  }, async (args) => safeWorkspaceTool(workspaces, args.workspace_id, (workspace) => memoryWrite(workspace, args.type, args.title, args.body, args.tags)));
  server.registerTool('get_project_context', {
    description: 'Return compact project context files from .agent.',
    inputSchema: { workspace_id: z.string() }
  }, async (args) => safeWorkspaceTool(workspaces, args.workspace_id, getProjectContext));
}


async function safeWorkspaceTool(workspaces: Awaited<ReturnType<typeof buildWorkspaces>>, workspaceId: string, fn: (workspace: ReturnType<typeof getWorkspace>) => Promise<unknown>) {
  try {
    const result = await fn(getWorkspace(workspaces, workspaceId));
    return asText(result as never);
  } catch (error) {
    return asText(fail(error instanceof Error ? error.message : String(error)));
  }
}

function safePolicy(workspaces: Awaited<ReturnType<typeof buildWorkspaces>>, workspaceId: string) {
  try {
    return asText(workspacePolicy(getWorkspace(workspaces, workspaceId)));
  } catch (error) {
    return asText(fail(error instanceof Error ? error.message : String(error)));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
