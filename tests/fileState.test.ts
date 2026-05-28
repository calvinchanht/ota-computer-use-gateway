import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { fileState, sameFileState } from '../src/core/fileState.js';

describe('fileState', () => {
  it('compares size and mtime', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'gtp-state-'));
    const file = path.join(root, 'a.txt');
    await writeFile(file, 'a');
    const first = await fileState(file);
    expect(sameFileState(first, first)).toBe(true);
    expect(sameFileState(first, { ...first, size: first.size + 1 })).toBe(false);
  });
});
