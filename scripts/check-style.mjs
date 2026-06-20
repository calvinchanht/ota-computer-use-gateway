#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

const roots = ['src', 'scripts'];
const maxFileLines = 1000;
const maxFunctionLines = 40;
const sourceExts = new Set(['.ts', '.js', '.mjs', '.cjs']);
const failures = [];

for (const file of await collectFiles(roots)) {
  const text = await fs.readFile(file, 'utf8');
  checkFileLines(file, text);
  if (sourceExts.has(path.extname(file))) checkFunctionLines(file, text);
}

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('style ok');

async function collectFiles(roots) {
  const files = [];
  for (const root of roots) await collect(root, files);
  return files.filter((file) => !isExcludedPath(normalize(file)));
}

async function collect(target, files) {
  const entries = await fs.readdir(target, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) await collectEntry(target, entry, files);
}

async function collectEntry(parent, entry, files) {
  const full = path.join(parent, entry.name);
  if (entry.isDirectory()) return collect(full, files);
  if (entry.isFile()) files.push(full);
}

function checkFileLines(file, text) {
  if (isGeneratedOrManifest(file)) return;
  const lines = text.split('\n').length;
  if (lines > maxFileLines) failures.push(`${file}: ${lines} lines > ${maxFileLines}`);
}

function checkFunctionLines(file, text) {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    if (isFunctionStart(lines[i])) checkFunctionBlock(file, lines, i);
  }
}

function isFunctionStart(line) {
  const trimmed = line.trim();
  if (trimmed.startsWith('//') || trimmed.startsWith('*')) return false;
  return /^(export\s+)?(async\s+)?function\s+\w+/.test(trimmed)
    || /^(async\s+)?\w+\([^)]*\)\s*[:\w<>\[\]\s|]*\{/.test(trimmed)
    || /^\(?[\w\s,]*\)?\s*=>\s*\{/.test(trimmed);
}

function checkFunctionBlock(file, lines, start) {
  const end = findBlockEnd(lines, start);
  if (end === null) return;
  if (isDeclarativeCommandRegistration(file, lines, start, end)) return;
  if (isEmbeddedScriptFactory(lines, start, end)) return;
  const count = end - start + 1;
  if (count > maxFunctionLines) failures.push(`${file}:${start + 1} function has ${count} lines > ${maxFunctionLines}`);
}

function findBlockEnd(lines, start) {
  let depth = 0;
  let seen = false;
  for (let i = start; i < lines.length; i += 1) {
    for (const char of stripStrings(lines[i])) {
      if (char === '{') { depth += 1; seen = true; }
      if (char === '}') depth -= 1;
    }
    if (seen && depth === 0) return i;
  }
  return null;
}

function stripStrings(line) {
  return line.replace(/(['"`])(?:\\.|(?!\1).)*\1/g, '');
}

function isExcludedPath(file) {
  return file.includes('/node_modules/')
    || file.includes('/dist/')
    || file.includes('/coverage/')
    || file.includes('/tests/')
    || file.includes('/test/')
    || file.endsWith('.test.ts')
    || file.endsWith('.test.js')
    || file.endsWith('.test.mjs')
    || file.endsWith('.spec.ts')
    || file.endsWith('.spec.js')
    || file.endsWith('.d.ts');
}

function isGeneratedOrManifest(file) {
  const normalized = normalize(file);
  return normalized.includes('/docs/examples/') || normalized.includes('/chatgpt-projects/');
}

function isDeclarativeCommandRegistration(file, lines, start, end) {
  const normalized = normalize(file);
  if (!normalized.endsWith('src/cli/commands.ts')) return false;
  const block = lines.slice(start, end + 1).join('\n');
  return countMatches(block, /\.command\(/g) >= 5 && countMatches(block, /\.action\(/g) >= 5;
}

function isEmbeddedScriptFactory(lines, start, end) {
  const block = lines.slice(start, end + 1).join('\n');
  return /return\s+`/.test(block) && /(?:document|window|location|querySelector|getComputedStyle)\b/.test(block);
}

function countMatches(value, pattern) {
  return [...value.matchAll(pattern)].length;
}

function normalize(file) {
  return file.replace(/\\/g, '/');
}
