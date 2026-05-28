import os from 'node:os';

export type PlatformKind = 'linux' | 'macos' | 'windows' | 'unknown';

export function platformKind(value = process.platform): PlatformKind {
  if (value === 'linux') return 'linux';
  if (value === 'darwin') return 'macos';
  if (value === 'win32') return 'windows';
  return 'unknown';
}

export function platformInfo() {
  return {
    platform: platformKind(),
    node: process.version,
    arch: process.arch,
    hostname: os.hostname(),
    homedir_label: 'current user home'
  };
}
