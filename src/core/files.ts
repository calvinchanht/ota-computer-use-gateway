import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

export type DirEntry = { name: string; type: 'file' | 'dir' | 'other' };

export async function listEntries(dir: string, maxEntries: number): Promise<DirEntry[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries.slice(0, maxEntries).map((entry) => ({ name: entry.name, type: entryType(entry) }));
}

function entryType(entry: { isDirectory(): boolean; isFile(): boolean }): DirEntry['type'] {
  if (entry.isDirectory()) return 'dir';
  if (entry.isFile()) return 'file';
  return 'other';
}

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
  return { start_line: start + 1, end_line: start + selected.length, text: selected.join('\n'), total_lines: lines.length };
}

export function joinDisplay(base: string, name: string): string {
  return base === '.' ? name : path.posix.join(base.replaceAll('\\', '/'), name);
}
