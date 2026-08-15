import type { ChildEnvironmentMode } from './securityPolicy.js';

const MINIMAL_ENV_KEYS = ['PATH', 'Path', 'PATHEXT', 'HOME', 'USERPROFILE', 'TEMP', 'TMP', 'LANG', 'LC_ALL', 'SHELL', 'COMSPEC', 'SystemRoot', 'WINDIR'] as const;

export function childProcessEnvironment(mode: ChildEnvironmentMode = 'minimal', overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const base = mode === 'full' ? { ...process.env } : minimalEnvironment();
  return { ...base, ...overrides };
}

function minimalEnvironment(): NodeJS.ProcessEnv {
  const values: NodeJS.ProcessEnv = {};
  for (const key of MINIMAL_ENV_KEYS) {
    const value = compatibilityEnvironmentValue(key);
    if (value !== undefined) values[key] = value;
  }
  return values;
}

function compatibilityEnvironmentValue(key: typeof MINIMAL_ENV_KEYS[number]): string | undefined {
  if (key === 'PATH') return process.env.PATH ?? process.env.Path;
  if (key === 'Path') return process.env.Path;
  if (key === 'HOME') return process.env.HOME ?? process.env.USERPROFILE;
  if (key === 'USERPROFILE') return process.env.USERPROFILE;
  return process.env[key];
}
