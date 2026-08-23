import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AppConfig } from '../config/schema.js';
import type { Workspace } from '../core/workspaces.js';
import { CANONICAL_PROVIDER_TOOL_NAMES } from '../tools/actionSurface.js';
import { allowedTools } from '../tools/policy.js';
import { registerApprovalTools } from './register/approvals.js';
import { registerArtifactTools } from './register/artifacts.js';
import { registerBrowserTools } from './register/browser.js';
import { registerComputerTools } from './register/computer.js';
import { registerFileTools } from './register/files.js';
import { registerGitTools } from './register/git.js';
import { registerGatewayTools } from './register/gateway.js';
import { registerGenesisTools } from './register/genesis.js';
import { registerJobLifecycleTools } from './register/jobLifecycle.js';
import { registerLargeFileTools } from './register/largeFiles.js';
import { registerMemoryTools } from './register/memory.js';
import { registerOtaMemoryTools } from './register/otaMemory.js';
import { registerPatchTools } from './register/patch.js';
import { registerProcessTools } from './register/processes.js';
import { registerSkillTools } from './register/skills.js';
import { registerWorkspaceTools } from './register/workspace.js';
import { registerWorkspaceHelperTools } from './register/workspaceHelpers.js';
import { setToolAnnotationMode } from './register/annotations.js';
import type { RegisterContext } from './register/types.js';

export type WorkspaceMap = Map<string, Workspace>;

export function registerTools(server: McpServer, config: AppConfig, workspaces: WorkspaceMap): void {
  setToolAnnotationMode(config.server.tool_annotations.mode);
  const context: RegisterContext = { server: filteredServer(server, config, workspaces), config, workspaces };
  registerGatewayTools(context);
  registerJobLifecycleTools(context);
  registerGenesisTools(context);
  registerWorkspaceTools(context);
  registerWorkspaceHelperTools(context);
  registerArtifactTools(context);
  registerBrowserTools(context);
  registerComputerTools(context);
  registerFileTools(context);
  registerLargeFileTools(context);
  registerGitTools(context);
  registerMemoryTools(context);
  registerOtaMemoryTools(context);
  registerSkillTools(context);
  registerPatchTools(context);
  registerApprovalTools(context);
  registerProcessTools(context);
}

function filteredServer(server: McpServer, config: AppConfig, workspaces: WorkspaceMap): McpServer {
  const canonical = new Set<string>(CANONICAL_PROVIDER_TOOL_NAMES);
  const roleAndOsTools = workspaces.size > 0
    ? [...workspaces.values()].flatMap((workspace) => allowedTools(workspace))
    : [...CANONICAL_PROVIDER_TOOL_NAMES];
  const configuredExtensions = (config.server.exposed_tools ?? []).filter((name) => !canonical.has(name));
  const exposed = new Set([...roleAndOsTools, ...configuredExtensions]);
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
