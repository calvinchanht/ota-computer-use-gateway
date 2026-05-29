import { z } from 'zod';
import { runWorkspaceTool } from '../../core/toolRunner.js';
import { getProjectContext, memorySearch, memoryWrite } from '../../tools/memory.js';
import { READ_ONLY, WRITE_FILE, RUN_LOCAL } from './annotations.js';
import type { RegisterContext } from './types.js';

export function registerMemoryTools({ server, workspaces }: RegisterContext): void {
  server.registerTool('memory_search', { title: 'Memory search', description: 'Search project-local memory files.', inputSchema: { workspace_id: z.string(), query: z.string(), max_results: z.number().optional() }, annotations: READ_ONLY }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'memory_search', (workspace) => memorySearch(workspace, args.query, args.max_results)));
  server.registerTool('memory_write', { title: 'Memory write', description: 'Append a project-local memory entry after secret checks.', inputSchema: { workspace_id: z.string(), type: z.string(), title: z.string(), body: z.string(), tags: z.array(z.string()).optional() }, annotations: WRITE_FILE }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'memory_write', (workspace) => memoryWrite(workspace, args.type, args.title, args.body, args.tags)));
  server.registerTool('get_project_context', { title: 'Get project context', description: 'Return compact project context files from .agent.', inputSchema: { workspace_id: z.string() }, annotations: READ_ONLY }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'get_project_context', getProjectContext));
}
