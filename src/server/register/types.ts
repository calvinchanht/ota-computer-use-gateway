import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AppConfig } from '../../config/schema.js';
import type { Workspace } from '../../core/workspaces.js';

export type WorkspaceMap = Map<string, Workspace>;
export type RegisterContext = { server: McpServer; config: AppConfig; workspaces: WorkspaceMap };
