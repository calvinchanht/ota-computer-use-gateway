import { describe, expect, it } from 'vitest';
import { shellInvocation } from '../src/core/commandAdapter.js';

describe('shellInvocation', () => {
  it('uses POSIX shell on linux and macOS', () => {
    expect(shellInvocation('echo ok', 'linux')).toEqual({ command: '/bin/sh', args: ['-lc', 'echo ok'] });
    expect(shellInvocation('echo ok', 'macos')).toEqual({ command: '/bin/sh', args: ['-lc', 'echo ok'] });
  });

  it('uses cmd on windows', () => {
    expect(shellInvocation('echo ok', 'windows')).toEqual({ command: 'cmd.exe', args: ['/d', '/s', '/c', 'echo ok'] });
  });

  it('uses configured shell runtime when supplied', () => {
    const runtime = {
      preferred_shell: 'powershell7',
      shell: {
        command: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
        args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command']
      }
    };
    expect(shellInvocation('Write-Output ok', 'windows', runtime)).toEqual({
      command: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
      args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', 'Write-Output ok']
    });
  });
});
