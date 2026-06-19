import { describe, expect, it } from 'vitest';
import { toolProfile } from '../src/tools/toolProfile.js';

describe('toolProfile', () => {
  it('documents canonical names, aliases, and deprecated tools', () => {
    const result = toolProfile();
    expect(result.data?.profile).toBe('api_explicit');
    expect(result.data?.canonical_tools).toContain('run_command');
    expect(result.data?.canonical_tools).toContain('write_process');
    expect(result.data?.aliases).toMatchObject({ Bash: 'run_command' });
    expect(result.data?.deprecated_tools).toMatchObject({ exec: 'run_command' });
    expect(result.data?.api_behavior).toMatchObject({ async_polling: { default_poll_after_ms: 5000 } });
    expect(result.data?.command_runtime).toMatchObject({ run_command_mode: 'argv_first_http' });
    expect(result.data?.command_runtime?.recommended_cmd_array_for_shell).toContain('<script>');
    expect(result.data?.tool_async).toMatchObject({ browser_cdp_batch: { may_return_running: true, default_async_mode: 'quota_saver' }, search_files: { may_return_running: true, default_async_mode: 'quota_saver' }, run_command: { may_return_running: true, default_async_mode: 'quota_saver' }, read_process: { tail_supported: true, cursor_field: 'cursor' } });
  });

  it('exposes configured PowerShell 7 runtime when supplied', () => {
    const result = toolProfile({
      command_runtime: {
        preferred_shell: 'powershell7',
        shell: { command: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe', args: ['-Command'] }
      }
    } as any);
    expect(result.data?.command_runtime).toMatchObject({
      preferred_shell: 'powershell7',
      shell_command: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
      shell_args_prefix: ['-Command']
    });
  });
});
