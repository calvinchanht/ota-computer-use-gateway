#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const HOUR_MS = 60 * 60 * 1000;
const DEFAULT_TTL_MS = HOUR_MS;
const DEFAULT_INTERVAL_MS = 15 * 60 * 1000;
const LOG_EXTENSIONS = new Set(['.log', '.out', '.err']);

if (isMainModule()) {
  const options = parseArgs(process.argv.slice(2));
  if (options.help || options.roots.length === 0) {
    printUsage();
    process.exit(options.help ? 0 : 2);
  }
  await run(options);
}

export async function pruneRuntimeLogs(options) {
  const now = options.now ?? Date.now();
  const roots = options.roots.map((root) => path.resolve(root));
  const summary = { ok: true, apply: options.apply, ttl_ms: options.ttlMs, roots, scanned: 0, deleted: [], kept: [], errors: [] };
  for (const root of roots) await scanRoot(root, options, now, summary);
  return summary;
}

function parseArgs(argv) {
  const options = { roots: [], ttlMs: DEFAULT_TTL_MS, intervalMs: DEFAULT_INTERVAL_MS, apply: false, watch: false, includeJsonl: true, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--root') options.roots.push(requiredValue(argv, ++index, arg));
    else if (arg === '--ttl-ms') options.ttlMs = positiveNumber(requiredValue(argv, ++index, arg), arg);
    else if (arg === '--ttl-hours') options.ttlMs = positiveNumber(requiredValue(argv, ++index, arg), arg) * HOUR_MS;
    else if (arg === '--interval-ms') options.intervalMs = positiveNumber(requiredValue(argv, ++index, arg), arg);
    else if (arg === '--apply') options.apply = true;
    else if (arg === '--watch') options.watch = true;
    else if (arg === '--no-jsonl') options.includeJsonl = false;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

async function run(options) {
  if (!options.watch) return printJson(await pruneRuntimeLogs(options));
  for (;;) {
    printJson(await pruneRuntimeLogs(options));
    await new Promise((resolve) => setTimeout(resolve, options.intervalMs));
  }
}

async function scanRoot(root, options, now, summary) {
  const entries = await fs.readdir(root, { withFileTypes: true }).catch((error) => {
    summary.errors.push({ path: root, error: error.message });
    return [];
  });
  for (const entry of entries) await scanEntry(root, entry, options, now, summary);
}

async function scanEntry(parent, entry, options, now, summary) {
  const absolute = path.join(parent, entry.name);
  if (entry.isDirectory()) return scanRoot(absolute, options, now, summary);
  if (!entry.isFile() || !isLogFile(entry.name, options)) return;
  summary.scanned += 1;
  const stat = await fs.stat(absolute).catch((error) => ({ error }));
  if (stat.error) return summary.errors.push({ path: absolute, error: stat.error.message });
  if (now - stat.mtimeMs < options.ttlMs) return summary.kept.push(absolute);
  if (options.apply) await fs.rm(absolute, { force: true });
  summary.deleted.push(absolute);
}

function isLogFile(name, options) {
  const extension = path.extname(name).toLowerCase();
  if (LOG_EXTENSIONS.has(extension)) return true;
  return options.includeJsonl && extension === '.jsonl';
}

function requiredValue(argv, index, flag) {
  if (index >= argv.length || argv[index].startsWith('--')) throw new Error(`${flag} requires a value`);
  return argv[index];
}

function positiveNumber(value, flag) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`${flag} must be a non-negative number`);
  return number;
}

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

function printUsage() {
  console.error('usage: node scripts/prune-runtime-logs.mjs --root <log-dir> [--ttl-hours 1] [--apply]');
  console.error('       node scripts/prune-runtime-logs.mjs --root <log-dir> --watch --apply [--interval-ms 900000]');
}

function isMainModule() {
  return path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url);
}
