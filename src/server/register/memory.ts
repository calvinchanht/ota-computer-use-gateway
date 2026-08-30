import { z } from 'zod';
import { runWorkspaceTool } from '../../core/toolRunner.js';
import { agentBootstrap, checkpointThread, contextSnapshot, recordDecision, recordHandoff, recordProgress, updateCurrentTask } from '../../tools/context.js';
import { getProjectContext } from '../../tools/memory.js';
import { READ_ONLY, WRITE_FILE, TOOL_RESULT_OUTPUT_SCHEMA } from './annotations.js';
import type { RegisterContext } from './types.js';
import { contentHeuristicsEnabled } from '../../core/securityPolicy.js';

export function registerMemoryTools(context: RegisterContext): void {
  registerProjectContext(context);
  registerContextSnapshot(context);
  registerAgentBootstrap(context);
  registerProgressRecorder(context);
  registerDecisionRecorder(context);
  registerHandoffRecorder(context);
  registerCurrentTaskUpdater(context);
  registerThreadCheckpoint(context);
}

function registerProjectContext({ server, workspaces }: RegisterContext): void {
  server.registerTool('get_project_context', projectContextSpec(), async (args) => runWorkspaceTool(
    workspaces, args.workspace_id, 'get_project_context', getProjectContext
  ));
}

function registerContextSnapshot({ server, workspaces }: RegisterContext): void {
  server.registerTool('get_context_snapshot', contextSnapshotSpec(), async (args) => runWorkspaceTool(
    workspaces, args.workspace_id, 'get_context_snapshot', contextSnapshot
  ));
}

function registerAgentBootstrap({ server, workspaces }: RegisterContext): void {
  server.registerTool('get_agent_bootstrap', bootstrapSpec(), async (args) => runWorkspaceTool(
    workspaces, args.workspace_id, 'get_agent_bootstrap', agentBootstrap
  ));
}

function registerProgressRecorder({ server, config, workspaces }: RegisterContext): void {
  server.registerTool('record_progress', noteSpec('Record progress', 'Append a progress note to workspace continuity.'), async (args) => runWorkspaceTool(
    workspaces, args.workspace_id, 'record_progress',
    (workspace) => recordProgress(workspace, args.title, args.body, false, contentHeuristicsEnabled(config))
  ));
}

function registerDecisionRecorder({ server, config, workspaces }: RegisterContext): void {
  server.registerTool('record_decision', noteSpec('Record decision', 'Append a decision note to workspace continuity.'), async (args) => runWorkspaceTool(
    workspaces, args.workspace_id, 'record_decision',
    (workspace) => recordDecision(workspace, args.title, args.body, contentHeuristicsEnabled(config))
  ));
}

function registerHandoffRecorder({ server, config, workspaces }: RegisterContext): void {
  server.registerTool('record_handoff', noteSpec('Record handoff', 'Append a handoff note for future thread pickup.'), async (args) => runWorkspaceTool(
    workspaces, args.workspace_id, 'record_handoff',
    (workspace) => recordHandoff(workspace, args.title, args.body, contentHeuristicsEnabled(config))
  ));
}

function registerCurrentTaskUpdater({ server, config, workspaces }: RegisterContext): void {
  server.registerTool('update_current_task', noteSpec('Update current task', 'Replace the current task continuity file.'), async (args) => runWorkspaceTool(
    workspaces, args.workspace_id, 'update_current_task',
    (workspace) => updateCurrentTask(workspace, args.title, args.body, contentHeuristicsEnabled(config))
  ));
}

function registerThreadCheckpoint({ server, config, workspaces }: RegisterContext): void {
  server.registerTool('checkpoint_thread', checkpointSpec(), async (args) => runWorkspaceTool(
    workspaces, args.workspace_id, 'checkpoint_thread',
    (workspace) => checkpointThread(workspace, args.title, args.summary, args.next_steps, contentHeuristicsEnabled(config))
  ));
}

function projectContextSpec() {
  return { title: 'Get project context', description: 'Return compact project context files from .agent.', inputSchema: { workspace_id: z.string() }, outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: READ_ONLY };
}

function contextSnapshotSpec() {
  return { title: 'Get context snapshot', description: 'Return workspace identity, project instructions, continuity files, and recent memory tail.', inputSchema: { workspace_id: z.string() }, outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: READ_ONLY };
}

function bootstrapSpec() {
  return { title: 'Get agent bootstrap', description: 'Return an ordered startup packet for a fresh or resumed chat-thread agent.', inputSchema: { workspace_id: z.string() }, outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: READ_ONLY };
}

function noteSpec(title: string, description: string) {
  return { title, description, inputSchema: { workspace_id: z.string(), title: z.string(), body: z.string() }, outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: WRITE_FILE };
}

function checkpointSpec() {
  return { title: 'Checkpoint thread', description: 'Append a structured chat-thread checkpoint for future pickup.', inputSchema: { workspace_id: z.string(), title: z.string(), summary: z.string(), next_steps: z.array(z.string()).default([]) }, outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: WRITE_FILE };
}
