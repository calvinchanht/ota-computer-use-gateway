import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function fileSymlinksSupported(): boolean {
  const root = mkdtempSync(join(tmpdir(), 'ota-symlink-capability-'));
  try {
    const target = join(root, 'target.txt');
    writeFileSync(target, 'test');
    symlinkSync(target, join(root, 'link.txt'));
    return true;
  } catch {
    return false;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
