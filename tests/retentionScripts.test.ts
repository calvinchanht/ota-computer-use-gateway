import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(import.meta.dirname, '..');

describe('runtime log retention script', () => {
  it('prunes stale telegram/threaddex logs and keeps recent files', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ota-log-retention-'));
    const oldLog = path.join(root, 'telegram-polling.log');
    const recentLog = path.join(root, 'threaddex.log');
    const dataFile = path.join(root, 'jobs.json');
    await writeFile(oldLog, 'old');
    await writeFile(recentLog, 'new');
    await writeFile(dataFile, '{}');
    await touch(oldLog, Date.now() - 2 * 60 * 60 * 1000);

    const result = runScript('scripts/prune-runtime-logs.mjs', ['--root', root, '--ttl-hours', '1', '--apply']);
    expect(result.status).toBe(0);
    expect(existsSync(oldLog)).toBe(false);
    expect(existsSync(recentLog)).toBe(true);
    expect(existsSync(dataFile)).toBe(true);
    await rm(root, { recursive: true, force: true });
  });
});

describe('deployment backup retention script', () => {
  it('aborts when active target is unavailable', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ota-deploy-retention-'));
    const result = runScript('scripts/prune-deployment-backups.mjs', ['--root', root, '--agent', 'genesis']);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).ok).toBe(false);
    await rm(root, { recursive: true, force: true });
  });

  it('keeps active deployment plus one previous backup', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ota-deploy-retention-'));
    const active = await deployDir(root, 'genesis-api-003', 1);
    const previous = await deployDir(root, 'genesis-api-002', 2);
    const stale = await deployDir(root, 'genesis-api-001', 3);
    const otherAgent = await deployDir(root, 'mickey-api-001', 4);
    const result = runScript('scripts/prune-deployment-backups.mjs', [
      '--root', root,
      '--agent', 'genesis',
      '--active-path', active,
      '--keep-previous', '1',
      '--apply'
    ]);
    const body = JSON.parse(result.stdout);
    expect(result.status).toBe(0);
    expect(body.ok).toBe(true);
    expect(existsSync(active)).toBe(true);
    expect(existsSync(previous)).toBe(true);
    expect(existsSync(stale)).toBe(false);
    expect(existsSync(otherAgent)).toBe(true);
    await rm(root, { recursive: true, force: true });
  });
});

function runScript(script: string, args: string[]) {
  return spawnSync(process.execPath, [path.join(repoRoot, script), ...args], {
    cwd: repoRoot,
    encoding: 'utf8'
  });
}

async function touch(file: string, timestampMs: number) {
  const date = new Date(timestampMs);
  await utimes(file, date, date);
}

async function deployDir(root: string, name: string, ageHours: number) {
  const dir = path.join(root, name);
  await mkdir(dir);
  await touch(dir, Date.now() - ageHours * 60 * 60 * 1000);
  return dir;
}
