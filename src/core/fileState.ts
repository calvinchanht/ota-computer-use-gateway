import { stat } from 'node:fs/promises';

export type FileState = { mtime_ms: number; size: number };

export async function fileState(path: string): Promise<FileState> {
  const info = await stat(path);
  return { mtime_ms: info.mtimeMs, size: info.size };
}

export function sameFileState(left: FileState, right: FileState): boolean {
  return left.mtime_ms === right.mtime_ms && left.size === right.size;
}
