import { platformKind, type PlatformKind } from './platform.js';
import type { AppConfig } from '../config/schema.js';

export type ShellInvocation = { command: string; args: string[] };
export type CommandRuntime = AppConfig['command_runtime'];
type ShellRuntime = NonNullable<CommandRuntime['shell']>;

export function shellInvocation(script: string, platform: PlatformKind = platformKind(), runtime?: CommandRuntime): ShellInvocation {
  if (runtime?.shell) return configuredShellInvocation(script, runtime.shell);
  if (platform === 'windows') return { command: 'cmd.exe', args: ['/d', '/s', '/c', script] };
  return { command: '/bin/sh', args: ['-lc', script] };
}

export function commandRuntimeInfo(platform: PlatformKind = platformKind(), runtime?: CommandRuntime) {
  const shell = shellInvocation('<script>', platform, runtime);
  const prefix = shell.args.slice(0, -1);
  return {
    platform,
    run_command_mode: 'argv_first_http',
    argv_recommendation: 'Prefer cmd_array with the executable and each argument as separate array entries.',
    shell_string_surfaces: ['mcp run_command command', 'run_configured_command', 'start_process command legacy'],
    preferred_shell: runtime?.preferred_shell ?? defaultShellName(platform),
    shell_command: shell.command,
    shell_args_prefix: prefix,
    shell_script_position: 'final_arg',
    recommended_cmd_array_for_shell: [shell.command, ...prefix, '<script>']
  };
}

function configuredShellInvocation(script: string, shell: ShellRuntime): ShellInvocation {
  return { command: shell.command, args: [...shell.args, script] };
}

function defaultShellName(platform: PlatformKind): string {
  if (platform === 'windows') return 'cmd';
  if (platform === 'linux' || platform === 'macos') return 'posix-sh';
  return 'platform-default';
}
