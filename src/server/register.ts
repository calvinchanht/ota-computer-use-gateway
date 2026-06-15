import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AppConfig } from '../config/schema.js';
import type { Workspace } from '../core/workspaces.js';
import { registerApprovalTools } from './register/approvals.js';
import { registerArtifactTools } from './register/artifacts.js';
import { registerBrowserTools } from './register/browser.js';
import { registerComputerTools } from './register/computer.js';
import { registerFileTools } from './register/files.js';
import { registerGitTools } from './register/git.js';
import { registerGatewayTools } from './register/gateway.js';
import { registerGenesisTools } from './register/genesis.js';
import { registerMemoryTools } from './register/memory.js';
import { registerPatchTools } from './register/patch.js';
import { registerProcessTools } from './register/processes.js';
import { registerSkillTools } from './register/skills.js';
import { registerThreaddexTools } from './register/threaddex.js';
import { registerWorkspaceTools } from './register/workspace.js';
import { setToolAnnotationMode } from './register/annotations.js';
import type { RegisterContext } from './register/types.js';

export type WorkspaceMap = Map<string, Workspace>;

export function registerTools(server: McpServer, config: AppConfig, workspaces: WorkspaceMap): void {
  setToolAnnotationMode(config.server.tool_annotations.mode);
  const context: RegisterContext = { server: filteredServer(server, config), config, workspaces };
  registerGatewayTools(context);
  registerGenesisTools(context);
  registerWorkspaceTools(context);
  registerArtifactTools(context);
  registerBrowserTools(context);
  registerComputerTools(context);
  registerFileTools(context);
  registerGitTools(context);
  registerMemoryTools(context);
  registerSkillTools(context);
  registerPatchTools(context);
  registerApprovalTools(context);
  registerProcessTools(context);
  registerThreaddexTools(context);
}

function filteredServer(server: McpServer, config: AppConfig): McpServer {
  const exposed = new Set(config.server.exposed_tools ?? []);
  if (exposed.size === 0) return server;
  return new Proxy(server, {
    get(target, prop, receiver) {
      if (prop !== 'registerTool') return Reflect.get(target, prop, receiver);
      return (name: string, ...args: unknown[]) => {
        if (!exposed.has(name)) return undefined;
        return (target.registerTool as (...registerArgs: unknown[]) => unknown).call(target, name, ...args);
      };
    }
  }) as McpServer;
}
