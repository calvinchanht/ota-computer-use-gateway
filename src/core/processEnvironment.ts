import type { ChildEnvironmentMode } from './securityPolicy.js';

const MINIMAL_ENV_KEYS = ['PATH', 'HOME', 'LANG', 'LC_ALL', 'SHELL'] as const;

export function childProcessEnvironment(mode: ChildEnvironmentMode = 'minimal', overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const base = mode === 'full' ? { ...process.env } : minimalEnvironment();
  return { ...base, ...overrides };
}

function minimalEnvironment(): NodeJS.ProcessEnv {
  const values: NodeJS.ProcessEnv = {};
  for (const key of MINIMAL_ENV_KEYS) {
    const value = key === 'PATH' ? (process.env.PATH ?? process.env.Path) : key === 'HOME' ? (process.env.HOME ?? process.env.USERPROFILE) : process.env[key];
    if (value !== undefined) values[key] = value;
  }
  return values;
}
