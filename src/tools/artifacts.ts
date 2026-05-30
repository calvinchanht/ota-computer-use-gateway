import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { agentPath, ensureAgentDir } from '../core/agentDir.js';
import { ok } from '../core/result.js';
import { looksSecret } from '../core/secrets.js';
import type { Workspace } from '../core/workspaces.js';

type Artifact = {
  id: string;
  path: string;
  title: string;
  kind: string;
  description: string;
  created_at: string;
};

type ArtifactIndex = { artifacts: Artifact[] };

export async function listArtifacts(workspace: Workspace) {
  const index = await readArtifactIndex(workspace);
  return ok(`listed ${index.artifacts.length} artifacts`, { workspace_id: workspace.id, artifacts: index.artifacts });
}

export async function recordArtifact(workspace: Workspace, artifactPath: string, title: string, kind = 'file', description = '') {
  validateArtifactInput(artifactPath, title, kind, description);
  await ensureAgentDir(workspace);
  const index = await readArtifactIndex(workspace);
  const artifact = artifactEntry(artifactPath, title, kind, description);
  index.artifacts = [artifact, ...index.artifacts.filter((item) => item.path !== artifact.path)].slice(0, 200);
  await writeFile(artifactIndexPath(workspace), `${JSON.stringify(index, null, 2)}\n`);
  return ok('artifact recorded', { workspace_id: workspace.id, artifact });
}

async function readArtifactIndex(workspace: Workspace): Promise<ArtifactIndex> {
  try {
    const parsed = JSON.parse(await readFile(artifactIndexPath(workspace), 'utf8')) as ArtifactIndex;
    return { artifacts: Array.isArray(parsed.artifacts) ? parsed.artifacts : [] };
  } catch { return { artifacts: [] }; }
}

function artifactEntry(artifactPath: string, title: string, kind: string, description: string): Artifact {
  const normalized = normalizeArtifactPath(artifactPath);
  return { id: artifactId(normalized), path: normalized, title: title.trim(), kind: kind.trim(), description: description.trim(), created_at: new Date().toISOString() };
}

function validateArtifactInput(artifactPath: string, title: string, kind: string, description: string) {
  if (!title.trim() || title.length > 200) throw new Error('artifact title must be 1-200 characters');
  if (!kind.trim() || kind.length > 80) throw new Error('artifact kind must be 1-80 characters');
  if (description.length > 2000) throw new Error('artifact description exceeds 2000 characters');
  if (looksSecret(`${title}\n${kind}\n${description}`)) throw new Error('artifact metadata appears to contain secrets');
  normalizeArtifactPath(artifactPath);
}

function normalizeArtifactPath(value: string) {
  if (!value || value.length > 1000) throw new Error('artifact path must be 1-1000 characters');
  if (path.isAbsolute(value)) throw new Error('artifact path must be workspace-relative');
  const normalized = path.posix.normalize(value.replaceAll('\\\\', '/'));
  if (normalized === '.' || normalized.startsWith('../') || normalized === '..') throw new Error('artifact path must stay inside the workspace');
  return normalized;
}

function artifactId(value: string) {
  return Buffer.from(value).toString('base64url').slice(0, 80);
}

function artifactIndexPath(workspace: Workspace) {
  return agentPath(workspace, 'ARTIFACTS.json');
}
