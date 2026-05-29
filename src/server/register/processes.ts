import { z } from 'zod';
import { asText } from '../../core/result.js';
import { runWorkspaceTool } from '../../core/toolRunner.js';
import { processKill, processList, processLog, processStart } from '../../tools/processes.js';
import { runConfiguredCommand, runShellTool } from '../../tools/runCommand.js';
import type { RegisterContext } from './types.js';

export function registerProcessTools({ server, config, workspaces }: RegisterContext): void {
  server.registerTool('run_command', { title: 'Run command', description: 'Run an allowlisted workspace command after approval.', inputSchema: { workspace_id: z.string(), command_id: z.string(), approval_action: z.string().optional() } }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'run_command', (workspace) => runConfiguredCommand(workspace, args.command_id, args.approval_action)));
  server.registerTool('exec', { title: 'Exec', description: 'Run an approved shell command in the workspace root.', inputSchema: { workspace_id: z.string(), command: z.string(), approval_action: z.string().default('exec') } }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'exec', (workspace) => runShellTool(config, workspace, args.command, args.approval_action)));
  server.registerTool('process_start', { title: 'Process start', description: 'Start an approved background shell command in the workspace root.', inputSchema: { workspace_id: z.string(), command: z.string(), approval_action: z.string().default('process_start') } }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'process_start', (workspace) => processStart(config, workspace, args.command, args.approval_action)));
  server.registerTool('process_list', { title: 'Process list', description: 'List managed background processes.', inputSchema: {} }, async () => asText(processList()));
  server.registerTool('process_log', { title: 'Process log', description: 'Read buffered output for a managed background process.', inputSchema: { process_id: z.string(), max_bytes: z.number().optional() } }, async (args) => asText(processLog(args.process_id, args.max_bytes)));
  server.registerTool('process_kill', { title: 'Process kill', description: 'Terminate a managed background process.', inputSchema: { process_id: z.string() } }, async (args) => asText(processKill(args.process_id)));
}
