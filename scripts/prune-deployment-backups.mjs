#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

if (isMainModule()) {
  const options = parseArgs(process.argv.slice(2));
  if (options.help || !options.root || !options.agent) {
    printUsage();
    process.exit(options.help ? 0 : 2);
  }
  printJson(await pruneDeploymentBackups(options));
}

export async function pruneDeploymentBackups(options) {
  const active = await resolveActiveTarget(options);
  if (!active) return abort('active target could not be determined', options);
  const candidates = await listCandidates(options, active);
  const inactive = candidates.filter((candidate) => !candidate.isActive);
  const keep = inactive.slice(0, options.keepPrevious ?? 1);
  const remove = inactive.slice(options.keepPrevious ?? 1);
  if (options.apply) for (const candidate of remove) await fs.rm(candidate.path, { recursive: true, force: true });
  return result(true, options, active, candidates, keep, remove);
}

function parseArgs(argv) {
  const options = { root: '', agent: '', service: '', activePath: '', activeSymlink: '', keepPrevious: 1, apply: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--root') options.root = requiredValue(argv, ++index, arg);
    else if (arg === '--agent') options.agent = requiredValue(argv, ++index, arg);
    else if (arg === '--service') options.service = requiredValue(argv, ++index, arg);
    else if (arg === '--active-path') options.activePath = requiredValue(argv, ++index, arg);
    else if (arg === '--active-symlink') options.activeSymlink = requiredValue(argv, ++index, arg);
    else if (arg === '--keep-previous') options.keepPrevious = positiveInteger(requiredValue(argv, ++index, arg), arg);
    else if (arg === '--apply') options.apply = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

async function resolveActiveTarget(options) {
  if (options.activePath) return realPath(options.activePath);
  if (!options.activeSymlink) return '';
  const stat = await fs.lstat(options.activeSymlink).catch(() => null);
  if (!stat?.isSymbolicLink()) return '';
  return realPath(options.activeSymlink);
}

async function listCandidates(options, active) {
  const root = path.resolve(options.root);
  const entries = await fs.readdir(root, { withFileTypes: true });
  const matched = entries.filter((entry) => entry.isDirectory() && matchesService(entry.name, options));
  const candidates = await Promise.all(matched.map((entry) => candidate(root, entry.name, active)));
  return candidates.sort((left, right) => right.mtime_ms - left.mtime_ms);
}

async function candidate(root, name, active) {
  const absolute = path.join(root, name);
  const resolved = await realPath(absolute);
  const stat = await fs.stat(absolute);
  const isActive = sameOrAncestor(resolved, active) || sameOrAncestor(active, resolved);
  return { name, path: absolute, resolved_path: resolved, mtime_ms: stat.mtimeMs, isActive };
}

function matchesService(name, options) {
  const service = options.service || options.agent;
  return name.toLowerCase().includes(service.toLowerCase());
}

function sameOrAncestor(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function realPath(target) {
  return fs.realpath(path.resolve(target)).catch(() => '');
}

function abort(reason, options) {
  return { ok: false, reason, root: path.resolve(options.root || '.'), agent: options.agent, apply: options.apply };
}

function result(ok, options, active, candidates, keep, remove) {
  return {
    ok,
    apply: options.apply,
    agent: options.agent,
    service: options.service || options.agent,
    root: path.resolve(options.root),
    active_target: active,
    kept_active: candidates.filter((candidate) => candidate.isActive).map((candidate) => candidate.path),
    kept_previous: keep.map((candidate) => candidate.path),
    deleted_older_backups: remove.map((candidate) => candidate.path)
  };
}

function requiredValue(argv, index, flag) {
  if (index >= argv.length || argv[index].startsWith('--')) throw new Error(`${flag} requires a value`);
  return argv[index];
}

function positiveInteger(value, flag) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) throw new Error(`${flag} must be a non-negative integer`);
  return number;
}

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

function printUsage() {
  console.error('usage: node scripts/prune-deployment-backups.mjs --root <deployments-dir> --agent <agent> --active-symlink <current> [--apply]');
  console.error('       node scripts/prune-deployment-backups.mjs --root <deployments-dir> --agent <agent> --active-path <dir> [--keep-previous 1]');
}

function isMainModule() {
  return path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url);
}
