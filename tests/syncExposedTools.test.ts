import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import YAML from 'yaml';

const roots: string[] = [];
const script = resolve('scripts/sync-exposed-tools.mjs');

afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe('sync-exposed-tools', () => {
  it('enables a validated comma-separated API-set list', async () => {
    const config = await fixture();
    const result = run(config, 'workspace,browser,computer_windows,machine_admin');
    expect(result.status, result.stderr).toBe(0);
    const parsed = YAML.parse(await readFile(config, 'utf8'));
    expect(parsed.workspaces[0].api_sets).toMatchObject({ workspace: true, browser: true, computer_windows: true, machine_admin: true });
  });

  it('rejects an unknown or malformed API-set name', async () => {
    const config = await fixture();
    const result = run(config, 'workspace browser');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('unsupported --enable-api-sets value: workspace browser');
  });
});

function run(config: string, sets: string) {
  return spawnSync(process.execPath, [script, '--config', config, '--workspace-id', 'test', '--enable-api-sets', sets, '--host-platform', 'windows'], { encoding: 'utf8' });
}

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'ota-sync-tools-'));
  roots.push(root);
  const config = join(root, 'config.yaml');
  await writeFile(config, YAML.stringify({ server: { host: '127.0.0.1', port: 8765 }, workspaces: [{ id: 'test', name: 'Test', root, api_sets: {} }] }));
  return config;
}
