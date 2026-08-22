import { describe, expect, it } from 'vitest';
import { windowsPowerShellJsonScript } from '../src/tools/windowsComputer.js';

describe('Windows PowerShell JSON transport', () => {
  it('pins PowerShell 5.1 stdout to UTF-8 before emitting JSON', () => {
    const payload = `@{ value='香港✓' } | ConvertTo-Json`;
    const script = windowsPowerShellJsonScript(payload);

    expect(script).toContain("$ProgressPreference='SilentlyContinue';");
    expect(script).toContain('[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false);');
    expect(script).toContain('$OutputEncoding=[Console]::OutputEncoding;');
    expect(script.indexOf('[Console]::OutputEncoding')).toBeLessThan(script.indexOf(payload));
  });
});
