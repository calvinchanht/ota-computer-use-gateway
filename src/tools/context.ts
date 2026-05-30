import { appendFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { agentPath, ensureAgentDir, readAgentFile } from '../core/agentDir.js';
import { ok } from '../core/result.js';
import { looksSecret } from '../core/secrets.js';
import type { Workspace } from '../core/workspaces.js';

const ROOT_CONTEXT = ['AGENTS.md', 'AGENTS.override.md', 'README.md'];
const AGENT_CONTEXT = ['PROJECT_CONTEXT.md', 'CURRENT_TASK.md', 'DECISIONS.md', 'HANDOFF.md', 'PROGRESS.md'];
const MAX_FILE_CHARS = 8000;

export async function contextSnapshot(workspace: Workspace) {
  await ensureAgentDir(workspace);
  return ok('context snapshot loaded', {
    identity: workspaceIdentity(workspace),
    project_instructions: await readRootFiles(workspace),
    continuity: await readAgentFiles(workspace),
    recent_memory: await readAgentMemoryTail(workspace)
  });
}

export async function recordProgress(workspace: Workspace, title: string, body: string, handoff = false) {
  if (looksSecret(`${title}\n${body}`)) throw new Error('progress note appears to contain secrets');
  await ensureAgentDir(workspace);
  const file = handoff ? 'HANDOFF.md' : 'PROGRESS.md';
  await appendFile(agentPath(workspace, file), formatNote(title, body));
  return ok('progress note recorded', { file, title, handoff });
}

function workspaceIdentity(workspace: Workspace) {
  return {
    id: workspace.id,
    name: workspace.name,
    root_label: 'configured workspace root',
    capabilities: {
      read: workspace.allow_read,
      write: workspace.allow_write,
      patch: workspace.allow_patch,
      exec: workspace.allow_tests,
      screen: workspace.allow_screen,
      mouse_keyboard: workspace.allow_mouse_keyboard
    }
  };
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

function truncate(text: string) {
  return text.length <= MAX_FILE_CHARS ? text : `${text.slice(0, MAX_FILE_CHARS)}\n[truncated]`;
}

function formatNote(title: string, body: string) {
  return `\n## ${new Date().toISOString()} — ${title}\n\n${body.trim()}\n`;
}
