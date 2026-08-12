import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { Workspace } from '../core/workspaces.js';

export async function resolveServedArtifactPath(workspace: Workspace, artifactPath: string): Promise<string | null> {
  const normalized = path.posix.normalize(artifactPath.replaceAll('\\', '/'));
  if (normalized.startsWith('../') || normalized === '..' || path.isAbsolute(normalized)) return null;
  if (!normalized.startsWith('.agent/artifacts/')) return null;

  try {
    const agentDir = await realpath(workspace.realAgentDir);
    const artifactsRoot = path.resolve(agentDir, 'artifacts');
    const realArtifactsRoot = await realpath(artifactsRoot);
    if (path.resolve(realArtifactsRoot) !== artifactsRoot) return null;

    const relativeToAgent = normalized.slice('.agent/'.length);
    const candidate = path.resolve(agentDir, relativeToAgent);
    if (!pathInside(artifactsRoot, candidate)) return null;
    if ((await lstat(candidate)).isSymbolicLink()) return null;

    const realCandidate = await realpath(candidate);
    return pathInside(realArtifactsRoot, realCandidate) ? realCandidate : null;
  } catch {
    return null;
  }
}

export async function openServedArtifact(resolved: string): Promise<{ body: Buffer } | null> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const noFollow = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0;
    handle = await open(resolved, constants.O_RDONLY | noFollow);
    const info = await handle.stat();
    if (!info.isFile()) return null;
    return { body: await handle.readFile() };
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function pathInside(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate);
  return Boolean(rel) && !rel.startsWith('..') && !path.isAbsolute(rel);
}
