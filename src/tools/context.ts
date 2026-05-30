import { appendFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { agentPath, ensureAgentDir, readAgentFile } from '../core/agentDir.js';
import { ok } from '../core/result.js';
import { looksSecret } from '../core/secrets.js';
import type { Workspace } from '../core/workspaces.js';

const ROOT_CONTEXT = ['AGENTS.md', 'AGENTS.override.md', 'README.md'];
const AGENT_CONTEXT = [
  'AGENT_START_HERE.md', 'SOUL.md', 'USER.md', 'TOOLS.md', 'ESTATE_CONTEXT.md',
  'PROJECT_CONTEXT.md', 'CURRENT_TASK.md', 'DECISIONS.md', 'HANDOFF.md', 'PROGRESS.md', 'CHECKPOINTS.md'
];
const MAX_FILE_CHARS = 8000;

export async function contextSnapshot(workspace: Workspace) {
  await ensureAgentDir(workspace);
  return ok('context snapshot loaded', await buildContextSnapshot(workspace));
}

export async function agentBootstrap(workspace: Workspace) {
  await ensureAgentDir(workspace);
  const snapshot = await buildContextSnapshot(workspace);
  return ok('agent bootstrap loaded', {
    identity: snapshot.identity,
    operating_model: chatThreadOperatingModel(),
    agent_start_here: snapshot.continuity['AGENT_START_HERE.md'],
    agent_profile: {
      soul: snapshot.continuity['SOUL.md'],
      user: snapshot.continuity['USER.md'],
      tools: snapshot.continuity['TOOLS.md'],
      estate_context: snapshot.continuity['ESTATE_CONTEXT.md']
    },
    project_instructions: snapshot.project_instructions,
    current_task: snapshot.continuity['CURRENT_TASK.md'],
    recent_handoff: snapshot.continuity['HANDOFF.md'],
    recent_progress: snapshot.continuity['PROGRESS.md'],
    recent_checkpoints: snapshot.continuity['CHECKPOINTS.md'],
    skills_hint: 'Call list_skills, then read_skill for relevant runbooks only when needed.',
    next_actions: bootstrapNextActions()
  });
}

export async function recordProgress(workspace: Workspace, title: string, body: string, handoff = false) {
  await appendCheckedNote(workspace, handoff ? 'HANDOFF.md' : 'PROGRESS.md', title, body);
  return ok('progress note recorded', { file: handoff ? 'HANDOFF.md' : 'PROGRESS.md', title, handoff });
}

export async function recordDecision(workspace: Workspace, title: string, body: string) {
  await appendCheckedNote(workspace, 'DECISIONS.md', title, body);
  return ok('decision recorded', { file: 'DECISIONS.md', title });
}

export async function recordHandoff(workspace: Workspace, title: string, body: string) {
  await appendCheckedNote(workspace, 'HANDOFF.md', title, body);
  return ok('handoff recorded', { file: 'HANDOFF.md', title });
}

export async function updateCurrentTask(workspace: Workspace, title: string, body: string) {
  checkSecrets(title, body);
  await ensureAgentDir(workspace);
  await writeFile(agentPath(workspace, 'CURRENT_TASK.md'), formatCurrentTask(title, body));
  return ok('current task updated', { file: 'CURRENT_TASK.md', title });
}

export async function checkpointThread(workspace: Workspace, title: string, summary: string, nextSteps: string[] = []) {
  const body = formatCheckpoint(summary, nextSteps);
  await appendCheckedNote(workspace, 'CHECKPOINTS.md', title, body);
  return ok('thread checkpoint recorded', { file: 'CHECKPOINTS.md', title, next_steps: nextSteps.length });
}

async function buildContextSnapshot(workspace: Workspace) {
  return {
    identity: workspaceIdentity(workspace),
    project_instructions: await readRootFiles(workspace),
    continuity: await readAgentFiles(workspace),
    recent_memory: await readAgentMemoryTail(workspace)
  };
}

function workspaceIdentity(workspace: Workspace) {
  return {
    id: workspace.id,
    name: workspace.name,
    root_label: 'configured workspace root',
    capabilities: workspaceCapabilities(workspace)
  };
}

function workspaceCapabilities(workspace: Workspace) {
  return {
    read: workspace.allow_read,
    write: workspace.allow_write,
    patch: workspace.allow_patch,
    exec: workspace.allow_tests,
    screen: workspace.allow_screen,
    mouse_keyboard: workspace.allow_mouse_keyboard
  };
}

function chatThreadOperatingModel() {
  return [
    'Use this bootstrap once at thread start or pickup.',
    'Behave like an OpenClaw-style workspace agent, not a stateless tool caller.',
    'Use retrieval tools when more local context is needed.',
    'Do not expect Tool Gateway to inject full context every turn.',
    'Checkpoint progress, decisions, current task, and handoff outward to the workspace.'
  ];
}

function bootstrapNextActions() {
  return [
    'Read agent_start_here, current_task, recent_handoff, recent_progress, and recent_checkpoints.',
    'Call get_workspace_policy and get_tool_profile if tool/capability posture is unclear.',
    'Call list_skills/read_skill for relevant workspace runbooks.',
    'Call memory_search/read_file for details only when needed.',
    'Call checkpoint_thread or record_handoff before stopping or switching threads.'
  ];
}

async function readRootFiles(workspace: Workspace) {
  return Object.fromEntries(await Promise.all(ROOT_CONTEXT.map(async (file) => [file, await readRootFile(workspace, file)])));
}

async function readAgentFiles(workspace: Workspace) {
  return Object.fromEntries(await Promise.all(AGENT_CONTEXT.map(async (file) => [file, await readAgentFile(workspace, file)])));
}

async function readRootFile(workspace: Workspace, file: string) {
  try { return truncate(await readFile(path.join(workspace.realRoot, file), 'utf8')); }
  catch { return ''; }
}

async function readAgentMemoryTail(workspace: Workspace) {
  const text = await readAgentFile(workspace, 'MEMORY_LOG.jsonl');
  return truncate(text.split('\n').filter(Boolean).slice(-20).join('\n'));
}

async function appendCheckedNote(workspace: Workspace, file: string, title: string, body: string) {
  checkSecrets(title, body);
  await ensureAgentDir(workspace);
  await appendFile(agentPath(workspace, file), formatNote(title, body));
}

function checkSecrets(title: string, body: string) {
  if (looksSecret(`${title}\n${body}`)) throw new Error('context note appears to contain secrets');
}

function truncate(text: string) {
  return text.length <= MAX_FILE_CHARS ? text : `${text.slice(0, MAX_FILE_CHARS)}\n[truncated]`;
}

function formatCurrentTask(title: string, body: string) {
  return `# ${title}\n\nUpdated: ${new Date().toISOString()}\n\n${body.trim()}\n`;
}

function formatCheckpoint(summary: string, nextSteps: string[]) {
  const steps = nextSteps.map((step) => `- ${step}`).join('\n');
  return nextSteps.length ? `${summary.trim()}\n\nNext steps:\n${steps}` : summary.trim();
}

function formatNote(title: string, body: string) {
  return `\n## ${new Date().toISOString()} — ${title}\n\n${body.trim()}\n`;
}
