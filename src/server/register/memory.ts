import { z } from 'zod';
import { runWorkspaceTool } from '../../core/toolRunner.js';
import { agentBootstrap, checkpointThread, contextSnapshot, recordDecision, recordHandoff, recordProgress, updateCurrentTask } from '../../tools/context.js';
import { getProjectContext, memorySearch, memoryWrite } from '../../tools/memory.js';
import { READ_ONLY, WRITE_FILE, TOOL_RESULT_OUTPUT_SCHEMA } from './annotations.js';
import type { RegisterContext } from './types.js';

export function registerMemoryTools(context: RegisterContext): void {
  registerMemorySearch(context);
  registerMemoryWrite(context);
  registerProjectContext(context);
  registerContextSnapshot(context);
  registerAgentBootstrap(context);
  registerProgressRecorder(context);
  registerDecisionRecorder(context);
  registerHandoffRecorder(context);
  registerCurrentTaskUpdater(context);
  registerThreadCheckpoint(context);
}

function registerMemorySearch({ server, workspaces }: RegisterContext): void {
  server.registerTool('memory_search', memorySearchSpec(), async (args) => runWorkspaceTool(
    workspaces, args.workspace_id, 'memory_search',
    (workspace) => memorySearch(workspace, args.query, args.max_results)
  ));
}

function registerMemoryWrite({ server, workspaces }: RegisterContext): void {
  server.registerTool('memory_write', memoryWriteSpec(), async (args) => runWorkspaceTool(
    workspaces, args.workspace_id, 'memory_write',
    (workspace) => memoryWrite(workspace, args.type, args.title, args.body, args.tags)
  ));
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

function registerProgressRecorder({ server, workspaces }: RegisterContext): void {
  server.registerTool('record_progress', noteSpec('Record progress', 'Append a progress note to workspace continuity.'), async (args) => runWorkspaceTool(
    workspaces, args.workspace_id, 'record_progress',
    (workspace) => recordProgress(workspace, args.title, args.body)
  ));
}

function registerDecisionRecorder({ server, workspaces }: RegisterContext): void {
  server.registerTool('record_decision', noteSpec('Record decision', 'Append a decision note to workspace continuity.'), async (args) => runWorkspaceTool(
    workspaces, args.workspace_id, 'record_decision',
    (workspace) => recordDecision(workspace, args.title, args.body)
  ));
}

function registerHandoffRecorder({ server, workspaces }: RegisterContext): void {
  server.registerTool('record_handoff', noteSpec('Record handoff', 'Append a handoff note for future thread pickup.'), async (args) => runWorkspaceTool(
    workspaces, args.workspace_id, 'record_handoff',
    (workspace) => recordHandoff(workspace, args.title, args.body)
  ));
}

function registerCurrentTaskUpdater({ server, workspaces }: RegisterContext): void {
  server.registerTool('update_current_task', noteSpec('Update current task', 'Replace the current task continuity file.'), async (args) => runWorkspaceTool(
    workspaces, args.workspace_id, 'update_current_task',
    (workspace) => updateCurrentTask(workspace, args.title, args.body)
  ));
}

function registerThreadCheckpoint({ server, workspaces }: RegisterContext): void {
  server.registerTool('checkpoint_thread', checkpointSpec(), async (args) => runWorkspaceTool(
    workspaces, args.workspace_id, 'checkpoint_thread',
    (workspace) => checkpointThread(workspace, args.title, args.summary, args.next_steps)
  ));
}

function memorySearchSpec() {
  return { title: 'Memory search', description: 'Search project-local memory files.', inputSchema: { workspace_id: z.string(), query: z.string(), max_results: z.number().optional() }, outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: READ_ONLY };
}

function memoryWriteSpec() {
  return { title: 'Memory write', description: 'Append a project-local memory entry after secret checks.', inputSchema: { workspace_id: z.string(), type: z.string(), title: z.string(), body: z.string(), tags: z.array(z.string()).optional() }, outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: WRITE_FILE };
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
