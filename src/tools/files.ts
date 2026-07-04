import { access, appendFile, open, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileInfo, listEntries, mediaType, readBinary, readTextRange, treeEntries } from '../core/files.js';
import { ok } from '../core/result.js';
import { resolveInside, resolveWritableInside } from '../core/paths.js';
import type { AppConfig } from '../config/schema.js';
import type { Workspace } from '../core/workspaces.js';


export async function workspaceInventory(config: AppConfig, workspace: Workspace, maxEntries = 300) {
  if (!workspace.allow_read) throw new Error('workspace does not allow reads');
  const entries: Array<{ path: string; name: string; type: string; protected?: boolean; reason?: string }> = [];
  await walkInventory(workspace.realRoot, '.', entries, Math.min(maxEntries, 1000));
  return ok('workspace inventory', { root_label: 'configured workspace root', entries, truncated: entries.length >= Math.min(maxEntries, 1000), note: 'Inventory lists workspace names/metadata only.' });
}

async function walkInventory(root: string, relative: string, output: Array<{ path: string; name: string; type: string; protected?: boolean; reason?: string }>, maxEntries: number): Promise<void> {
  if (output.length >= maxEntries) return;
  const absolute = relative === '.' ? root : path.join(root, relative);
  const children = await readdir(absolute, { withFileTypes: true }).catch(() => []);
  for (const child of children) {
    if (output.length >= maxEntries) return;
    const childPath = relative === '.' ? child.name : path.posix.join(relative.replaceAll('\\', '/'), child.name);
    // Calvin policy: inventory must not hide or mark files as protected based on secret-looking names.
    // Access is governed by workspace/host scope, not by OTA-invented path blacklists.
    const item = { path: childPath, name: child.name, type: child.isDirectory() ? 'dir' : child.isFile() ? 'file' : 'other' };
    output.push(item);
    if (child.isDirectory()) await walkInventory(root, childPath, output, maxEntries);
  }
}

export async function listDir(config: AppConfig, workspace: Workspace, requestedPath: string, maxEntries = 200) {
  const resolved = await resolveInside(workspace, requestedPath, config);
  const entries = await listEntries(resolved.absolute, Math.min(maxEntries, 500));
  return ok(`listed ${entries.length} entries`, { path: resolved.displayPath, scope: resolved.scope, entries });
}

export async function statPath(config: AppConfig, workspace: Workspace, requestedPath: string) {
  const resolved = await resolveInside(workspace, requestedPath, config);
  return ok(`stat ${resolved.relative}`, { path: resolved.displayPath, scope: resolved.scope, ...(await fileInfo(resolved.absolute)) });
}

export async function treeTool(config: AppConfig, workspace: Workspace, requestedPath = '.', maxEntries = 200) {
  const resolved = await resolveInside(workspace, requestedPath, config);
  const entries = await treeEntries(resolved.absolute, Math.min(maxEntries, 500));
  return ok(`tree ${resolved.relative}`, { path: resolved.displayPath, scope: resolved.scope, entries, truncated: entries.length >= Math.min(maxEntries, 500) });
}

export async function readFileTool(config: AppConfig, workspace: Workspace, requestedPath: string, startLine = 1, maxLines = 250) {
  const resolved = await resolveInside(workspace, requestedPath, config);
  const range = await readTextRange(resolved.absolute, startLine, Math.min(maxLines, 500), config.security.max_file_bytes);
  return ok(`read ${resolved.relative}`, { path: resolved.displayPath, scope: resolved.scope, ...range });
}

export async function readBinaryFileTool(config: AppConfig, workspace: Workspace, requestedPath: string) {
  const resolved = await resolveInside(workspace, requestedPath, config);
  return ok(`read binary ${resolved.relative}`, { path: resolved.displayPath, scope: resolved.scope, ...(await readBinary(resolved.absolute, config.security.max_file_bytes)) });
}

export type WriteMode = 'create' | 'overwrite' | 'append' | 'patch';

export async function writeFileTool(config: AppConfig, workspace: Workspace, requestedPath: string, content: string, overwrite = false, mode?: WriteMode, offset?: number) {
  assertTextWriteAllowed(config, workspace, content);
  const resolved = await resolveWritableInside(workspace, requestedPath, config);
  const bytes = Buffer.from(content, 'utf8');
  const effectiveMode = resolveWriteMode(mode, overwrite);
  await writeBytes(resolved.absolute, bytes, effectiveMode, offset, config.security.max_file_bytes);
  return ok(`wrote ${resolved.relative}`, { path: resolved.displayPath, scope: resolved.scope, mode: effectiveMode, offset, bytes: bytes.length });
}

export async function writeBinaryFileTool(config: AppConfig, workspace: Workspace, requestedPath: string, base64: string, overwrite = false, mode?: WriteMode, offset?: number) {
  const bytes = decodeBase64(base64);
  assertBinaryWriteAllowed(config, workspace, bytes);
  const resolved = await resolveWritableInside(workspace, requestedPath, config);
  const effectiveMode = resolveWriteMode(mode, overwrite);
  await writeBytes(resolved.absolute, bytes, effectiveMode, offset, config.security.max_file_bytes);
  return ok(`wrote binary ${resolved.relative}`, { path: resolved.displayPath, scope: resolved.scope, mode: effectiveMode, offset, bytes: bytes.length, media_type: mediaType(resolved.absolute) });
}

export async function editFileTool(config: AppConfig, workspace: Workspace, requestedPath: string, oldText: string, newText: string) {
  assertTextWriteAllowed(config, workspace, newText);
  const resolved = await resolveInside(workspace, requestedPath, config);
  const current = await readFile(resolved.absolute, 'utf8');
  const next = replaceExactlyOnce(current, oldText, newText, resolved.relative);
  if (Buffer.byteLength(next, 'utf8') > config.security.max_file_bytes) throw new Error('edited file exceeds max_file_bytes');
  await writeFile(resolved.absolute, next, 'utf8');
  return ok(`edited ${resolved.relative}`, { path: resolved.displayPath, scope: resolved.scope, bytes: Buffer.byteLength(next, 'utf8') });
}

export async function deleteFileTool(config: AppConfig, workspace: Workspace, requestedPath: string) {
  if (!workspace.allow_write) throw new Error('workspace does not allow file writes');
  const resolved = await resolveInside(workspace, requestedPath, config);
  const info = await stat(resolved.absolute);
  if (!info.isFile()) throw new Error('delete_file only deletes regular files');
  await rm(resolved.absolute);
  return ok(`deleted ${resolved.relative}`, { path: resolved.displayPath, scope: resolved.scope, bytes: info.size });
}

export async function deletePathTool(config: AppConfig, workspace: Workspace, requestedPath: string, recursive = false) {
  if (!workspace.allow_write) throw new Error('workspace does not allow file writes');
  const resolved = await resolveInside(workspace, requestedPath, config);
  if (resolved.relative === '.') throw new Error(resolved.scope === 'host' ? 'refusing to delete host filesystem root' : 'refusing to delete workspace root');
  const info = await stat(resolved.absolute);
  if (info.isDirectory() && !recursive) throw new Error('path is a directory; set recursive=true to delete it');
  await rm(resolved.absolute, { recursive, force: false });
  return ok(`deleted ${resolved.relative}`, { path: resolved.displayPath, scope: resolved.scope, type: info.isDirectory() ? 'dir' : info.isFile() ? 'file' : 'other', recursive, bytes: info.isFile() ? info.size : undefined });
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

function resolveWriteMode(mode: WriteMode | undefined, overwrite: boolean): WriteMode {
  if (mode) return mode;
  return overwrite ? 'overwrite' : 'create';
}

async function writeBytes(absolutePath: string, bytes: Buffer, mode: WriteMode, offset: number | undefined, maxBytes: number): Promise<void> {
  if (mode === 'create') await writeCreate(absolutePath, bytes);
  else if (mode === 'overwrite') await writeFile(absolutePath, bytes);
  else if (mode === 'append') await writeAppend(absolutePath, bytes, maxBytes);
  else await writePatch(absolutePath, bytes, offset, maxBytes);
}

async function writeCreate(absolutePath: string, bytes: Buffer): Promise<void> {
  await assertNewFile(absolutePath);
  await writeFile(absolutePath, bytes);
}

async function writeAppend(absolutePath: string, bytes: Buffer, maxBytes: number): Promise<void> {
  await assertWithinFinalSize(absolutePath, bytes.length, maxBytes);
  await appendFile(absolutePath, bytes);
}

async function writePatch(absolutePath: string, bytes: Buffer, offset: number | undefined, maxBytes: number): Promise<void> {
  if (typeof offset !== 'number' || !Number.isInteger(offset) || offset < 0) throw new Error('offset is required for mode=patch and must be a non-negative integer');
  const patchOffset = offset;
  await assertPatchBounds(absolutePath, patchOffset, bytes.length, maxBytes);
  const file = await open(absolutePath, 'r+');
  try { await file.write(bytes, 0, bytes.length, patchOffset); } finally { await file.close(); }
}

async function assertWithinFinalSize(absolutePath: string, addedBytes: number, maxBytes: number): Promise<void> {
  const current = await stat(absolutePath).catch(() => undefined);
  if ((current?.size ?? 0) + addedBytes > maxBytes) throw new Error('final file exceeds max_file_bytes');
}

async function assertPatchBounds(absolutePath: string, offset: number, length: number, maxBytes: number): Promise<void> {
  const current = await stat(absolutePath);
  if (offset > current.size) throw new Error('offset is beyond end of file; use mode=append to grow the file');
  if (Math.max(current.size, offset + length) > maxBytes) throw new Error('final file exceeds max_file_bytes');
}
