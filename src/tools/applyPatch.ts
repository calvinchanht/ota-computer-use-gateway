import { readFile, writeFile } from 'node:fs/promises';
import { requireApproval } from './approval.js';
import { fileState, sameFileState, type FileState } from '../core/fileState.js';
import { sha256 } from '../core/hash.js';
import { resolveInside } from '../core/paths.js';
import { ok } from '../core/result.js';
import type { AppConfig } from '../config/schema.js';
import type { Workspace } from '../core/workspaces.js';
import type { PatchChange } from './patch.js';

export async function applyPatch(config: AppConfig, workspace: Workspace, changes: PatchChange[], approvalAction = 'apply_patch') {
  if (!workspace.allow_patch) throw new Error('workspace does not allow patch application');
  await requireApproval(workspace, approvalAction);
  const checked = await Promise.all(changes.map((change) => loadChange(config, workspace, change)));
  await Promise.all(checked.map(writeChange));
  return ok('patch applied', { files: checked.map((item) => item.path), hashes: checked.map(hashSummary) });
}

type LoadedChange = PatchChange & { absolute: string; before_hash: string; after_hash: string; before_state: FileState };

async function loadChange(config: AppConfig, workspace: Workspace, change: PatchChange): Promise<LoadedChange> {
  const resolved = await resolveInside(workspace, change.path, config);
  const current = await readFile(resolved.absolute, 'utf8');
  if (!current.includes(change.old_text)) throw new Error(`old_text not found in ${change.path}`);
  const next = current.replace(change.old_text, change.new_text);
  return { ...change, path: resolved.relative, absolute: resolved.absolute, before_hash: sha256(current), after_hash: sha256(next), before_state: await fileState(resolved.absolute) };
}

async function writeChange(change: LoadedChange): Promise<void> {
  const current = await readFile(change.absolute, 'utf8');
  if (!sameFileState(await fileState(change.absolute), change.before_state)) throw new Error(`file changed before apply: ${change.path}`);
  if (sha256(current) !== change.before_hash) throw new Error(`file changed before apply: ${change.path}`);
  await writeFile(change.absolute, current.replace(change.old_text, change.new_text));
}

function hashSummary(change: LoadedChange) {
  return { path: change.path, before: change.before_hash, after: change.after_hash };
}
