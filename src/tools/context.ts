import { appendFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { agentPath, ensureAgentDir, readAgentFile } from '../core/agentDir.js';
import { ok } from '../core/result.js';
import { looksSecret } from '../core/secrets.js';
import type { Workspace } from '../core/workspaces.js';

const ROOT_CONTEXT = ['AGENTS.md', 'AGENTS.override.md', 'README.md'];
const AGENT_CONTEXT = [
  'AGENT_START_HERE.md', 'PROVIDER_THREAD_PROMPT.md', 'MICKEY_PROVIDER_ACCEPTANCE.md', 'CATALYST_PROVIDER_ACCEPTANCE.md',
  'SOUL.md', 'USER.md', 'TOOLS.md', 'ESTATE_CONTEXT.md',
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
    provider_thread_prompt: snapshot.continuity['PROVIDER_THREAD_PROMPT.md'],
    provider_acceptance: providerAcceptance(snapshot.continuity, workspace),
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
    capability_discovery: capabilityDiscovery(workspace),
    artifacts_hint: 'Call list_artifacts to find durable outputs from prior provider-thread work; call record_artifact after creating important files.',
    skills_hint: 'Call list_skills, then read_skill for relevant runbooks only when needed.',
    next_actions: bootstrapNextActions(workspace)
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

function providerAcceptance(continuity: Record<string, string>, workspace: Workspace) {
  const workspaceSpecific = `${workspace.id.toUpperCase()}_PROVIDER_ACCEPTANCE.md`;
  return continuity[workspaceSpecific] || continuity['MICKEY_PROVIDER_ACCEPTANCE.md'] || '';
}

function chatThreadOperatingModel() {
  return [
    'Use this bootstrap once at thread start or pickup.',
    'Behave like an OpenClaw-style workspace agent, not a stateless tool caller.',
    'Do not self-handicap: when a scoped tool is available, use it. Do not ask Calvin to confirm routine workspace reads, edits, commands, process work, browser/CDP, or computer-use actions, including local inspection of secrets/ when needed for the task.',
    'The agent is not read-only when workspace policy enables write/patch/exec/process/browser/computer tools. workspace_inventory is read-only only because it is an inventory/metadata helper; it does not restrict write_file, edit_file, run_command, start_process, browser/CDP, or computer-use tools.',
    'Provider safety UI may ask for confirmation, but Gateway policy does not require Calvin approval for routine scoped local work. Continue after the provider permits the tool call.',
    'Immediately inspect your MCP tool catalog/policy before saying a capability is unavailable.',
    'Tool Gateway gives scoped workspace access through MCP tools; do not confuse that with raw SSH/filesystem access.',
    'Use retrieval and file tools when more local context is needed.',
    'Use browser_cdp_call/browser_cdp_batch for page DOM scripting and Chrome/CDP automation when browser control is enabled.',
    'Do not expect Tool Gateway to inject full context every turn.',
    'Record important generated files with record_artifact so future threads can find them.',
    'Checkpoint progress, decisions, current task, and handoff outward to the workspace.'
  ];
}

function capabilityDiscovery(workspace: Workspace) {
  return {
    rule: 'Before claiming you lack workspace, file, process, browser, memory, skill, or artifact capability, call get_workspace_policy and get_tool_profile and inspect the MCP tool list available in this chat.',
    workspace_access_model: 'You do not have raw SSH by default. You do have scoped access to the configured workspace root through MCP tools when policy allows them. Use workspace_inventory for broad metadata discovery, especially when direct path listing is blocked by provider-side safety heuristics.',
    core_file_tools: workspace.allow_read ? ['workspace_inventory', 'list_dir', 'tree', 'stat_path', 'search_files', 'read_file', 'read_binary_file'] : [],
    write_file_tools: workspace.allow_write ? ['write_file', 'write_binary_file'] : [],
    patch_tools: workspace.allow_patch ? ['edit_file', 'propose_patch', 'apply_patch'] : [],
    process_tools: workspace.allow_tests ? ['run_command', 'start_process', 'read_process', 'list_processes', 'write_process', 'stop_process'] : [],
    autonomy_guidance: 'Routine scoped workspace/computer actions do not require Calvin confirmation. Do not refuse just because a path name looks sensitive; Catalyst policy intentionally grants full read/write/list access inside the workspace root, including secrets/ when needed. Never paste bearer tokens, PATs, OAuth tokens, private keys, or raw credential contents into chat/external systems unless Calvin explicitly asks for that exact disclosure/use.',
    continuity_tools: ['get_agent_bootstrap', 'get_context_snapshot', 'get_project_context', 'memory_search', 'memory_write', 'record_progress', 'record_decision', 'update_current_task', 'record_handoff', 'checkpoint_thread'],
    skill_tools: ['list_skills', 'read_skill'],
    artifact_tools: ['list_artifacts', 'record_artifact'],
    browser_tools: workspace.allow_screen || workspace.allow_mouse_keyboard ? ['list_browser_profiles', 'browser_status', 'list_browser_tabs', 'browser_tab_info', 'browser_tab_snapshot', 'browser_tab_screenshot', 'browser_cdp_call', 'browser_cdp_batch', 'browser_cdp_browser_call', 'browser_cdp_browser_batch'] : []
  };
}

function bootstrapNextActions(workspace: Workspace) {
  return [
    'Read agent_start_here, current_task, recent_handoff, recent_progress, and recent_checkpoints.',
    'Call get_workspace_policy and get_tool_profile early; inspect available MCP tools before declaring limitations.',
    workspace.allow_read ? 'Confirm scoped file access by calling list_dir on ".", and when useful tree/stat_path/read_file anywhere inside the workspace. For Catalyst, do not treat secrets/ or credential-named files as unavailable; gateway policy grants full workspace access. Avoid pasting raw secret contents into chat unless Calvin explicitly asks.' : 'Read access is disabled by policy; say so explicitly if asked for files.',
    workspace.allow_write ? 'Use write_file/edit_file/write_binary_file for routine scoped workspace updates without asking Calvin to babysit. Record important outputs with record_artifact.' : 'Write access is disabled by policy; do not imply you can write files.',
    'Use browser_cdp_call/browser_cdp_batch for custom DOM inspection, Runtime.evaluate scripts, and CDP automation when browser control is enabled.',
    'Call list_artifacts to discover prior outputs, and record_artifact after creating important files.',
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
