import { z } from 'zod';
import { asText } from '../../core/result.js';
import { runWorkspaceTool } from '../../core/toolRunner.js';
import { READ_ONLY, RUN_LOCAL, TOOL_RESULT_OUTPUT_SCHEMA } from './annotations.js';
import { processKill, processList, processLog, processStart, processWrite } from '../../tools/processes.js';
import { runConfiguredCommand, runShellTool } from '../../tools/runCommand.js';
import type { RegisterContext } from './types.js';

export function registerProcessTools(context: RegisterContext): void {
  registerCommandTools(context);
  registerCanonicalProcessTools(context);
  registerDeprecatedProcessTools(context);
}

function registerCommandTools(context: RegisterContext): void {
  const { server, config, workspaces } = context;
  server.registerTool('run_command', commandTool(), async (args) => runWorkspaceTool(
    workspaces, args.workspace_id, 'run_command',
    (workspace) => runShellTool(config, workspace, args.command)
  ));
  server.registerTool('run_configured_command', configuredTool(), async (args) => runWorkspaceTool(
    workspaces, args.workspace_id, 'run_configured_command',
    (workspace) => runConfiguredCommand(workspace, args.command_id)
  ));
  server.registerTool('exec', execTool(), async (args) => runWorkspaceTool(
    workspaces, args.workspace_id, 'exec',
    (workspace) => runShellTool(config, workspace, args.command)
  ));
}

function registerCanonicalProcessTools(context: RegisterContext): void {
  const { server, config, workspaces } = context;
  server.registerTool('start_process', startProcessTool(), async (args) => runWorkspaceTool(
    workspaces, args.workspace_id, 'start_process',
    (workspace) => processStart(config, workspace, args.command)
  ));
  server.registerTool('list_processes', listProcessTool(false), async () => asText(processList()));
  server.registerTool('read_process', readProcessTool(false), async (args) => asText(processLog(args.process_id, args.max_bytes)));
  server.registerTool('write_process', writeProcessTool(), async (args) => asText(processWrite(args.process_id, args.input, args.close_stdin)));
  server.registerTool('stop_process', stopProcessTool(false), async (args) => asText(processKill(args.process_id)));
}

function registerDeprecatedProcessTools(context: RegisterContext): void {
  const { server, config, workspaces } = context;
  server.registerTool('process_start', startProcessTool(true), async (args) => runWorkspaceTool(
    workspaces, args.workspace_id, 'process_start',
    (workspace) => processStart(config, workspace, args.command)
  ));
  server.registerTool('process_list', listProcessTool(true), async () => asText(processList()));
  server.registerTool('process_log', readProcessTool(true), async (args) => asText(processLog(args.process_id, args.max_bytes)));
  server.registerTool('process_kill', stopProcessTool(true), async (args) => asText(processKill(args.process_id)));
}

function commandTool() {
  return {
    title: 'Run command',
    description: 'Run a scoped local shell command in the workspace root.',
    inputSchema: { workspace_id: z.string(), command: z.string() },
    outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: RUN_LOCAL
  };
}

function configuredTool() {
  return {
    title: 'Run configured command',
    description: 'Run an allowlisted workspace command by id.',
    inputSchema: { workspace_id: z.string(), command_id: z.string() },
    outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: RUN_LOCAL
  };
}

function execTool() {
  return {
    title: 'Exec (deprecated)',
    description: 'Deprecated OpenClaw-compatible alias for run_command.',
    inputSchema: { workspace_id: z.string(), command: z.string() },
    outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: RUN_LOCAL
  };
}

function startProcessTool(deprecated = false) {
  return {
    title: deprecated ? 'Process start (deprecated)' : 'Start process',
    description: deprecated ? 'Deprecated alias for start_process.' : 'Start a scoped local background shell command.',
    inputSchema: { workspace_id: z.string(), command: z.string() },
    outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: RUN_LOCAL
  };
}

function listProcessTool(deprecated: boolean) {
  return {
    title: deprecated ? 'Process list (deprecated)' : 'List processes',
    description: deprecated ? 'Deprecated alias for list_processes.' : 'List managed background processes.',
    inputSchema: {},
    outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: READ_ONLY
  };
}

function readProcessTool(deprecated: boolean) {
  return {
    title: deprecated ? 'Process log (deprecated)' : 'Read process',
    description: deprecated ? 'Deprecated alias for read_process.' : 'Read buffered output for a managed process.',
    inputSchema: { process_id: z.string(), max_bytes: z.number().optional() },
    outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: READ_ONLY
  };
}

function writeProcessTool() {
  return {
    title: 'Write process',
    description: 'Write UTF-8 input to a managed background process stdin.',
    inputSchema: { process_id: z.string(), input: z.string(), close_stdin: z.boolean().default(false) },
    outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: RUN_LOCAL
  };
}

function stopProcessTool(deprecated: boolean) {
  return {
    title: deprecated ? 'Process kill (deprecated)' : 'Stop process',
    description: deprecated ? 'Deprecated alias for stop_process.' : 'Terminate a managed background process.',
    inputSchema: { process_id: z.string() },
    outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: RUN_LOCAL
  };
}
