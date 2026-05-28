import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { configPathFromArg, loadConfig } from './config/load.js';
import { asText, fail } from './core/result.js';
import { buildWorkspaces, getWorkspace } from './core/workspaces.js';
import { heartbeat } from './tools/heartbeat.js';
import { workspacePolicy } from './tools/policy.js';

async function main(): Promise<void> {
  const config = await loadConfig(configPathFromArg(process.argv));
  const workspaces = await buildWorkspaces(config);
  const server = new McpServer({ name: 'gtp-local-mcp-agent', version: '0.1.0' });
  registerBaseTools(server, workspaces);
  await server.connect(new StdioServerTransport());
}

function registerBaseTools(server: McpServer, workspaces: Awaited<ReturnType<typeof buildWorkspaces>>): void {
  server.registerTool('heartbeat', { description: 'Report local agent availability.' }, async () => asText(heartbeat(workspaces)));
  server.registerTool('get_workspace_policy', {
    description: 'Return allowed tools and policy for a workspace.',
    inputSchema: { workspace_id: z.string() }
  }, async ({ workspace_id }) => safePolicy(workspaces, workspace_id));
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
