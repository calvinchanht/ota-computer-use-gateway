import { lstatSync, mkdirSync, realpathSync } from 'node:fs';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Workspace } from './workspaces.js';

export function agentPath(workspace: Workspace, ...parts: string[]): string {
  const base = assertAgentDir(workspace);
  const candidate = path.resolve(base, ...parts);
  if (!pathInside(base, candidate)) throw new Error('agent path escapes workspace agent directory');
  assertNoSymlinkComponents(base, candidate);
  return candidate;
}

export async function ensureAgentDir(workspace: Workspace): Promise<void> {
  await mkdir(agentPath(workspace, 'audit'), { recursive: true });
  await mkdir(agentPath(workspace, 'patches'), { recursive: true });
}

export async function readAgentFile(workspace: Workspace, name: string): Promise<string> {
  try { return await readFile(agentPath(workspace, name), 'utf8'); } catch { return ''; }
}

export async function appendMemory(workspace: Workspace, entry: unknown): Promise<void> {
  await ensureAgentDir(workspace);
  await appendFile(agentPath(workspace, 'MEMORY_LOG.jsonl'), JSON.stringify(entry) + '\n');
}

function assertAgentDir(workspace: Workspace): string {
  const root = realpathSync(workspace.realRoot);
  const base = path.resolve(workspace.realAgentDir ?? path.join(root, '.agent'));
  if (!pathInside(root, base)) throw codedError('workspace agent directory must stay inside workspace root', 'EACCES');

  const relative = path.relative(root, base);
  let current = root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    const next = path.join(current, segment);
    try {
      const info = lstatSync(next);
      if (info.isSymbolicLink()) throw codedError('workspace agent directory must not contain symlinks', 'ELOOP');
      if (!info.isDirectory()) throw codedError('workspace agent directory is not a real directory', 'ENOTDIR');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      mkdirSync(next, { mode: 0o700 });
      const info = lstatSync(next);
      if (info.isSymbolicLink() || !info.isDirectory()) throw codedError('workspace agent directory is not a real directory', 'ENOTDIR');
    }
    const resolved = realpathSync(next);
    if (!pathInside(root, resolved)) throw codedError('workspace agent directory escaped or changed', 'EACCES');
    current = resolved;
  }
  return current;
}

function assertNoSymlinkComponents(base: string, candidate: string): void {
  const relative = path.relative(base, candidate);
  let current = base;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    try {
      const info = lstatSync(current);
      if (info.isSymbolicLink()) throw new Error('agent path must not traverse symlinks');
      const resolved = realpathSync(current);
      if (!pathInsideOrEqual(base, resolved)) throw new Error('agent path resolves outside agent directory');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
  }
}

function pathInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function pathInsideOrEqual(root: string, candidate: string): boolean {
  return path.resolve(root) === path.resolve(candidate) || pathInside(root, candidate);
}

function codedError(message: string, code: string): NodeJS.ErrnoException {
  const error = new Error(message) as NodeJS.ErrnoException;
  error.code = code;
  return error;
}
