import { readFile, writeFile } from 'node:fs/promises';
import { ensureAgentDir, agentPath } from '../core/agentDir.js';
import { resolveInside } from '../core/paths.js';
import { ok } from '../core/result.js';
import type { AppConfig } from '../config/schema.js';
import type { Workspace } from '../core/workspaces.js';

export type PatchChange = { path: string; old_text: string; new_text: string };

export async function proposePatch(config: AppConfig, workspace: Workspace, changes: PatchChange[], reason: string) {
  if (!workspace.allow_patch) throw new Error('workspace does not allow patch proposals');
  await ensureAgentDir(workspace);
  const checked = await Promise.all(changes.map((change) => validateChange(config, workspace, change)));
  const patchId = `patch_${new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14)}`;
  const diff = checked.map((change) => renderDiff(change.path, change.old_text, change.new_text)).join('\n');
  await writeFile(agentPath(workspace, 'patches', `${patchId}.diff`), diff);
  return ok('patch proposal stored', { patch_id: patchId, reason, files: checked.map((item) => item.path), diff_preview: diff.slice(0, 8000) });
}

async function validateChange(config: AppConfig, workspace: Workspace, change: PatchChange): Promise<PatchChange> {
  const resolved = await resolveInside(workspace, change.path, config);
  const current = await readFile(resolved.absolute, 'utf8');
  if (!current.includes(change.old_text)) throw new Error(`old_text not found in ${change.path}`);
  return { ...change, path: resolved.relative };
}

function renderDiff(filePath: string, oldText: string, newText: string): string {
  const header = `--- a/${filePath}\n+++ b/${filePath}`;
  const oldLines = oldText.split('\n').map((line) => `-${line}`).join('\n');
  const newLines = newText.split('\n').map((line) => `+${line}`).join('\n');
  return `${header}\n@@ proposed replacement @@\n${oldLines}\n${newLines}\n`;
}
