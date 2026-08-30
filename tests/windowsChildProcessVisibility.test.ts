import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('..', import.meta.url));

function source(path: string): string {
  return readFileSync(join(root, path), 'utf8');
}

describe('Windows child-process visibility', () => {
  it('hides command and Windows-computer implementation consoles at process creation', () => {
    const managed = source('src/core/processManager.ts');
    const command = source('src/core/process.ts');
    const computer = source('src/tools/windowsComputer.ts');

    expect(managed).toMatch(/spawn\(command, args, \{[^}]*windowsHide: true/);
    expect(command).toMatch(/spawn\(cmd, args, \{[^}]*windowsHide: true/);
    expect(computer).toMatch(/execFileAsync\('powershell\.exe',[\s\S]*?windowsHide: true/);
  });
});
