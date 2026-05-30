import { access, readFile, writeFile } from 'node:fs/promises';
import { fileInfo, listEntries, mediaType, readBinary, readTextRange, treeEntries } from '../core/files.js';
import { ok } from '../core/result.js';
import { resolveInside, resolveWritableInside } from '../core/paths.js';
import type { AppConfig } from '../config/schema.js';
import type { Workspace } from '../core/workspaces.js';

export async function listDir(config: AppConfig, workspace: Workspace, requestedPath: string, maxEntries = 200) {
  const resolved = await resolveInside(workspace, requestedPath, config);
  const entries = await listEntries(resolved.absolute, Math.min(maxEntries, 500));
  return ok(`listed ${entries.length} entries`, { path: resolved.relative, entries });
}

export async function statPath(config: AppConfig, workspace: Workspace, requestedPath: string) {
  const resolved = await resolveInside(workspace, requestedPath, config);
  return ok(`stat ${resolved.relative}`, { path: resolved.relative, ...(await fileInfo(resolved.absolute)) });
}

export async function treeTool(config: AppConfig, workspace: Workspace, requestedPath = '.', maxEntries = 200) {
  const resolved = await resolveInside(workspace, requestedPath, config);
  const entries = await treeEntries(resolved.absolute, Math.min(maxEntries, 500));
  return ok(`tree ${resolved.relative}`, { path: resolved.relative, entries, truncated: entries.length >= Math.min(maxEntries, 500) });
}

export async function readFileTool(config: AppConfig, workspace: Workspace, requestedPath: string, startLine = 1, maxLines = 250) {
  const resolved = await resolveInside(workspace, requestedPath, config);
  const range = await readTextRange(resolved.absolute, startLine, Math.min(maxLines, 500), config.security.max_file_bytes);
  return ok(`read ${resolved.relative}`, { path: resolved.relative, ...range });
}

export async function readBinaryFileTool(config: AppConfig, workspace: Workspace, requestedPath: string) {
  const resolved = await resolveInside(workspace, requestedPath, config);
  return ok(`read binary ${resolved.relative}`, { path: resolved.relative, ...(await readBinary(resolved.absolute, config.security.max_file_bytes)) });
}

export async function writeFileTool(config: AppConfig, workspace: Workspace, requestedPath: string, content: string, overwrite = false) {
  assertTextWriteAllowed(config, workspace, content);
  const resolved = await resolveWritableInside(workspace, requestedPath, config);
  if (!overwrite) await assertNewFile(resolved.absolute);
  await writeFile(resolved.absolute, content, 'utf8');
  return ok(`wrote ${resolved.relative}`, { path: resolved.relative, bytes: Buffer.byteLength(content, 'utf8') });
}

export async function writeBinaryFileTool(config: AppConfig, workspace: Workspace, requestedPath: string, base64: string, overwrite = false) {
  const bytes = decodeBase64(base64);
  assertBinaryWriteAllowed(config, workspace, bytes);
  const resolved = await resolveWritableInside(workspace, requestedPath, config);
  if (!overwrite) await assertNewFile(resolved.absolute);
  await writeFile(resolved.absolute, bytes);
  return ok(`wrote binary ${resolved.relative}`, { path: resolved.relative, bytes: bytes.length, media_type: mediaType(resolved.absolute) });
}

export async function editFileTool(config: AppConfig, workspace: Workspace, requestedPath: string, oldText: string, newText: string) {
  assertTextWriteAllowed(config, workspace, newText);
  const resolved = await resolveInside(workspace, requestedPath, config);
  const current = await readFile(resolved.absolute, 'utf8');
  const next = replaceExactlyOnce(current, oldText, newText, resolved.relative);
  if (Buffer.byteLength(next, 'utf8') > config.security.max_file_bytes) throw new Error('edited file exceeds max_file_bytes');
  await writeFile(resolved.absolute, next, 'utf8');
  return ok(`edited ${resolved.relative}`, { path: resolved.relative, bytes: Buffer.byteLength(next, 'utf8') });
}

function assertTextWriteAllowed(config: AppConfig, workspace: Workspace, content: string): void {
  if (!workspace.allow_write) throw new Error('workspace does not allow file writes');
  if (Buffer.byteLength(content, 'utf8') > config.security.max_file_bytes) throw new Error('content exceeds max_file_bytes');
}

function assertBinaryWriteAllowed(config: AppConfig, workspace: Workspace, bytes: Buffer): void {
  if (!workspace.allow_write) throw new Error('workspace does not allow file writes');
  if (bytes.length > config.security.max_file_bytes) throw new Error('content exceeds max_file_bytes');
}

function decodeBase64(base64: string): Buffer {
  const bytes = Buffer.from(base64, 'base64');
  if (bytes.toString('base64').replace(/=+$/, '') !== base64.replace(/\s/g, '').replace(/=+$/, '')) throw new Error('invalid base64 content');
  return bytes;
}

function replaceExactlyOnce(current: string, oldText: string, newText: string, filePath: string): string {
  if (!oldText) throw new Error('old_text must not be empty');
  const first = current.indexOf(oldText);
  if (first === -1) throw new Error(`old_text not found in ${filePath}`);
  if (current.indexOf(oldText, first + oldText.length) !== -1) throw new Error(`old_text is not unique in ${filePath}`);
  return current.slice(0, first) + newText + current.slice(first + oldText.length);
}

async function assertNewFile(absolutePath: string): Promise<void> {
  await access(absolutePath).then(() => { throw new Error('file exists; set overwrite=true'); }, () => undefined);
}
