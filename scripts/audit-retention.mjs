#!/usr/bin/env node
import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import yazl from 'yazl';

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_ROTATE_AFTER_DAYS = 1;
const DEFAULT_PRUNE_ARCHIVES_AFTER_DAYS = 5;
const AUDIT_FILES = new Set(['tool_calls.jsonl', 'http_requests.jsonl']);

const auditDir = process.argv[2];
const rotateAfterDays = numberEnv('OTA_AUDIT_ROTATE_AFTER_DAYS', DEFAULT_ROTATE_AFTER_DAYS);
const pruneAfterDays = numberEnv('OTA_AUDIT_PRUNE_ARCHIVES_AFTER_DAYS', DEFAULT_PRUNE_ARCHIVES_AFTER_DAYS);

if (!auditDir) {
  console.error('usage: node scripts/audit-retention.mjs <workspace-agent-audit-dir>');
  console.error('example: node scripts/audit-retention.mjs /home/molt/hkerbot/workspace/.agent/audit');
  process.exit(2);
}

const now = Date.now();
const archiveDir = path.join(auditDir, 'archive');
await fs.mkdir(archiveDir, { recursive: true });

let rotated = 0;
let pruned = 0;

for (const name of AUDIT_FILES) {
  const file = path.join(auditDir, name);
  const info = await fs.stat(file).catch(() => null);
  if (!info?.isFile() || info.size === 0) continue;
  if (now - info.mtimeMs < rotateAfterDays * DAY_MS) continue;
  const stamp = new Date(info.mtimeMs).toISOString().replace(/[:.]/g, '-');
  const zipPath = path.join(archiveDir, `${name.replace(/\.jsonl$/, '')}-${stamp}.zip`);
  await zipSingleFile(file, name, zipPath);
  await fs.truncate(file, 0);
  rotated += 1;
}

const entries = await fs.readdir(archiveDir, { withFileTypes: true }).catch(() => []);
for (const entry of entries) {
  if (!entry.isFile() || !entry.name.endsWith('.zip')) continue;
  const absolute = path.join(archiveDir, entry.name);
  const info = await fs.stat(absolute).catch(() => null);
  if (!info?.isFile()) continue;
  if (now - info.mtimeMs > pruneAfterDays * DAY_MS) {
    await fs.rm(absolute, { force: true });
    pruned += 1;
  }
}

console.log(JSON.stringify({ ok: true, audit_dir: auditDir, archive_dir: archiveDir, rotate_after_days: rotateAfterDays, prune_archives_after_days: pruneAfterDays, rotated, pruned }, null, 2));

function numberEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function zipSingleFile(sourcePath, entryName, zipPath) {
  return new Promise((resolve, reject) => {
    const zip = new yazl.ZipFile();
    zip.addFile(sourcePath, entryName);
    zip.end();
    const out = createWriteStream(zipPath, { mode: 0o600 });
    zip.outputStream.pipe(out);
    zip.outputStream.on('error', reject);
    out.on('error', reject);
    out.on('close', resolve);
  });
}
