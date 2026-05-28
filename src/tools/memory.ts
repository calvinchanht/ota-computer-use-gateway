import { readFile } from 'node:fs/promises';
import { appendMemory, ensureAgentDir, readAgentFile, agentPath } from '../core/agentDir.js';
import { ok } from '../core/result.js';
import { looksSecret, redactSecrets } from '../core/secrets.js';
import type { Workspace } from '../core/workspaces.js';

export async function memoryWrite(workspace: Workspace, type: string, title: string, body: string, tags: string[] = []) {
  if (looksSecret(body)) throw new Error('memory body appears to contain secrets');
  const entry = { ts: new Date().toISOString(), type, title, body, tags };
  await appendMemory(workspace, entry);
  return ok('memory entry appended', { title, type, tags });
}

export async function memorySearch(workspace: Workspace, query: string, maxResults = 10) {
  const text = await readMemoryText(workspace);
  const results = text.split('\n').filter((line) => line.toLowerCase().includes(query.toLowerCase())).slice(0, maxResults);
  return ok(`found ${results.length} memory matches`, { query, results: results.map(redactSecrets) });
}

export async function getProjectContext(workspace: Workspace) {
  await ensureAgentDir(workspace);
  const files = ['PROJECT_CONTEXT.md', 'CURRENT_TASK.md', 'DECISIONS.md'];
  const data = Object.fromEntries(await Promise.all(files.map(async (file) => [file, await readAgentFile(workspace, file)])));
  return ok('project context loaded', data);
}

async function readMemoryText(workspace: Workspace): Promise<string> {
  const parts = await Promise.all(['MEMORY_LOG.jsonl', 'DECISIONS.md'].map((file) => readAgentFile(workspace, file)));
  try { parts.push(await readFile(agentPath(workspace, 'CURRENT_TASK.md'), 'utf8')); } catch { /* empty */ }
  return parts.join('\n');
}
