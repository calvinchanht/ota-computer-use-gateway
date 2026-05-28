import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
import { configSchema, type AppConfig } from './schema.js';

export async function loadConfig(path: string): Promise<AppConfig> {
  const raw = await readFile(path, 'utf8');
  const parsed = parse(raw) as unknown;
  return configSchema.parse(parsed);
}

export function configPathFromArg(argv: string[]): string {
  const flag = argv.findIndex((item) => item === '--config');
  if (flag >= 0 && argv[flag + 1]) return argv[flag + 1];
  return process.env.GTP_MCP_CONFIG ?? 'config.example.yaml';
}
