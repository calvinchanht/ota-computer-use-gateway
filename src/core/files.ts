import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { truncateText } from './text.js';

export type DirEntry = { name: string; type: 'file' | 'dir' | 'other' };
export type FileInfo = { type: DirEntry['type']; size: number; modified_at: string; media_type?: string };
export type TreeEntry = DirEntry & { path: string; size?: number };

export async function listEntries(dir: string, maxEntries: number): Promise<DirEntry[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries.slice(0, maxEntries).map((entry) => ({ name: entry.name, type: entryType(entry) }));
}

function statType(info: { isDirectory(): boolean; isFile(): boolean }): DirEntry['type'] {
  if (info.isDirectory()) return 'dir';
  if (info.isFile()) return 'file';
  return 'other';
}

async function walkTree(root: string, relative: string, output: TreeEntry[], maxEntries: number): Promise<void> {
  if (output.length >= maxEntries) return;
  const absolute = relative === '.' ? root : path.join(root, relative);
  const entries = await readdir(absolute, { withFileTypes: true });
  for (const entry of entries) await visitTreeEntry(root, relative, entry, output, maxEntries);
}

async function visitTreeEntry(root: string, base: string, entry: DirEntrySource, output: TreeEntry[], maxEntries: number): Promise<void> {
  if (output.length >= maxEntries) return;
  const entryPath = joinDisplay(base, entry.name);
  output.push({ path: entryPath, name: entry.name, type: entryType(entry) });
  if (entry.isDirectory()) await walkTree(root, entryPath, output, maxEntries);
}

type DirEntrySource = { name: string; isDirectory(): boolean; isFile(): boolean };

function entryType(entry: { isDirectory(): boolean; isFile(): boolean }): DirEntry['type'] {
  if (entry.isDirectory()) return 'dir';
  if (entry.isFile()) return 'file';
  return 'other';
}

export async function fileInfo(filePath: string): Promise<FileInfo> {
  const info = await stat(filePath);
  return { type: statType(info), size: info.size, modified_at: info.mtime.toISOString(), media_type: mediaType(filePath) };
}

export async function treeEntries(root: string, maxEntries: number): Promise<TreeEntry[]> {
  const output: TreeEntry[] = [];
  await walkTree(root, '.', output, maxEntries);
  return output;
}

export async function readBinary(file: string, maxBytes: number) {
  const info = await stat(file);
  if (!info.isFile()) throw new Error('path is not a file');
  if (info.size > maxBytes) throw new Error(`file exceeds max bytes: ${info.size}`);
  const raw = await readFile(file);
  return { bytes: raw.length, media_type: mediaType(file), base64: raw.toString('base64') };
}

export function mediaType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] ?? 'application/octet-stream';
}

const MIME_TYPES: Record<string, string> = {
  '.txt': 'text/plain', '.md': 'text/markdown', '.json': 'application/json',
  '.yaml': 'application/yaml', '.yml': 'application/yaml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.gif': 'image/gif', '.pdf': 'application/pdf', '.zip': 'application/zip'
};

export async function readTextRange(file: string, startLine: number, maxLines: number, maxBytes: number) {
  const info = await stat(file);
  if (!info.isFile()) throw new Error('path is not a file');
  if (info.size > maxBytes) throw new Error(`file exceeds max bytes: ${info.size}`);
  const raw = await readFile(file);
  if (raw.includes(0)) throw new Error('binary file refused');
  return sliceLines(raw.toString('utf8'), startLine, maxLines);
}

function sliceLines(text: string, startLine: number, maxLines: number) {
  const lines = text.split(/\r?\n/);
  const start = Math.max(1, startLine) - 1;
  const selected = lines.slice(start, start + maxLines);
  const joined = selected.join('\n');
  const limited = truncateText(joined, 50000);
  return { start_line: start + 1, end_line: start + selected.length, text: limited.text, total_lines: lines.length, truncated: limited.truncated };
}

export function joinDisplay(base: string, name: string): string {
  return base === '.' ? name : path.posix.join(base.replaceAll('\\', '/'), name);
}
