import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AppConfig } from '../config/schema.js';
import { buildWorkspaces } from '../core/workspaces.js';
import { registerTools } from './register.js';

export async function createServer(config: AppConfig): Promise<McpServer> {
  const workspaces = await buildWorkspaces(config);
  const server = new McpServer({ name: 'gtp-local-mcp-agent', version: '0.1.0' });
  registerTools(server, config, workspaces);
  return server;
}
