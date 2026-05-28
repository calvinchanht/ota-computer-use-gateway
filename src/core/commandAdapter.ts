import { platformKind, type PlatformKind } from './platform.js';

export type ShellInvocation = { command: string; args: string[] };

export function shellInvocation(script: string, platform: PlatformKind = platformKind()): ShellInvocation {
  if (platform === 'windows') return { command: 'cmd.exe', args: ['/d', '/s', '/c', script] };
  return { command: '/bin/sh', args: ['-lc', script] };
}
