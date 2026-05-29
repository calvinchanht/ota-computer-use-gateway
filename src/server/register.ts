import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AppConfig } from '../config/schema.js';
import type { Workspace } from '../core/workspaces.js';
import { registerApprovalTools } from './register/approvals.js';
import { registerFileTools } from './register/files.js';
import { registerGitTools } from './register/git.js';
import { registerMemoryTools } from './register/memory.js';
import { registerPatchTools } from './register/patch.js';
import { registerProcessTools } from './register/processes.js';
import { registerWorkspaceTools } from './register/workspace.js';
import type { RegisterContext } from './register/types.js';

export type WorkspaceMap = Map<string, Workspace>;

export function registerTools(server: McpServer, config: AppConfig, workspaces: WorkspaceMap): void {
  const context: RegisterContext = { server, config, workspaces };
  registerWorkspaceTools(context);
  registerFileTools(context);
  registerGitTools(context);
  registerMemoryTools(context);
  registerPatchTools(context);
  registerApprovalTools(context);
  registerProcessTools(context);
}
