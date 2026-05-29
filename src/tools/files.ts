import { access, writeFile } from 'node:fs/promises';
import { listEntries, readTextRange } from '../core/files.js';
import { ok } from '../core/result.js';
import { resolveInside, resolveWritableInside } from '../core/paths.js';
import type { AppConfig } from '../config/schema.js';
import type { Workspace } from '../core/workspaces.js';

export async function listDir(config: AppConfig, workspace: Workspace, requestedPath: string, maxEntries = 200) {
  const resolved = await resolveInside(workspace, requestedPath, config);
  const entries = await listEntries(resolved.absolute, Math.min(maxEntries, 500));
  return ok(`listed ${entries.length} entries`, { path: resolved.relative, entries });
}

export async function readFileTool(config: AppConfig, workspace: Workspace, requestedPath: string, startLine = 1, maxLines = 250) {
  const resolved = await resolveInside(workspace, requestedPath, config);
  const range = await readTextRange(resolved.absolute, startLine, Math.min(maxLines, 500), config.security.max_file_bytes);
  return ok(`read ${resolved.relative}`, { path: resolved.relative, ...range });
}

export async function writeFileTool(config: AppConfig, workspace: Workspace, requestedPath: string, content: string, overwrite = false) {
  if (!workspace.allow_write) throw new Error('workspace does not allow file writes');
  if (Buffer.byteLength(content, 'utf8') > config.security.max_file_bytes) throw new Error('content exceeds max_file_bytes');
  const resolved = await resolveWritableInside(workspace, requestedPath, config);
  if (!overwrite) await assertNewFile(resolved.absolute);
  await writeFile(resolved.absolute, content, 'utf8');
  return ok(`wrote ${resolved.relative}`, { path: resolved.relative, bytes: Buffer.byteLength(content, 'utf8') });
}

async function assertNewFile(absolutePath: string): Promise<void> {
  await access(absolutePath).then(() => { throw new Error('file exists; set overwrite=true'); }, () => undefined);
}
