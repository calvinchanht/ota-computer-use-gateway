import { createHash } from 'node:crypto';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AppConfig } from '../config/schema.js';
import type { Workspace } from '../core/workspaces.js';
import { resolveInside, resolveWritableInside } from '../core/paths.js';
import { mediaType } from '../core/files.js';
import { ok } from '../core/result.js';

const TEXT_DECODER = new TextDecoder('utf-8', { fatal: false });
const DEFAULT_MAX_BYTES = 50_000;
const MAX_SCAN_BYTES = 25_000_000;
const MAX_MATCHES = 200;
const SKIP_DIRS = new Set(['.git', 'node_modules', '.cache', '.browser-profiles', 'browser-profiles', 'context-backups', 'data', 'logs', 'memory', 'tmp']);

type Row = Record<string, string>;
type FilterSpec = Record<string, unknown>;

export async function inferFileStructure(config: AppConfig, workspace: Workspace, requestedPath: string) {
  const resolved = await resolveInside(workspace, requestedPath, config);
  const meta = await fileMeta(resolved.absolute);
  const sample = await readSampleBytes(resolved.absolute, Math.min(meta.size, 256_000));
  const text = sample.text;
  const lines = text.split(/\r?\n/);
  const detected = detectTextType(resolved.relative, text);
  const data: Record<string, unknown> = { path: resolved.relative, ...meta, detected_type: detected, sample_line_count: lines.length };
  if (detected === 'csv' || detected === 'tsv') Object.assign(data, tableStructure(text, detected === 'tsv' ? '\t' : ','));
  if (detected === 'json') Object.assign(data, safeJsonProfile(meta.size <= MAX_SCAN_BYTES ? await readBoundedText(resolved.absolute, MAX_SCAN_BYTES) : text, 2, 3));
  if (detected === 'jsonl') data.jsonl_samples = lines.filter(Boolean).slice(0, 5).map((line) => safeParseJson(line));
  return ok(`inferred ${resolved.relative}`, data);
}

export async function sampleFile(config: AppConfig, workspace: Workspace, requestedPath: string, mode = 'head_tail_random', headLines = 20, tailLines = 20, randomLines = 20, maxBytes = 20_000) {
  const resolved = await resolveInside(workspace, requestedPath, config);
  const text = await readBoundedText(resolved.absolute, MAX_SCAN_BYTES);
  const lines = text.split(/\r?\n/);
  const picks: Array<{ section: string; line: number; text: string }> = [];
  if (mode.includes('head')) lines.slice(0, headLines).forEach((line, i) => picks.push({ section: 'head', line: i + 1, text: line }));
  if (mode.includes('tail')) lines.slice(Math.max(0, lines.length - tailLines)).forEach((line, i) => picks.push({ section: 'tail', line: Math.max(1, lines.length - tailLines) + i, text: line }));
  if (mode.includes('random') && lines.length > headLines + tailLines) {
    const start = headLines;
    const end = Math.max(start, lines.length - tailLines);
    const step = Math.max(1, Math.floor((end - start) / Math.max(1, randomLines)));
    for (let lineNo = start + 1; lineNo <= end && picks.filter((p) => p.section === 'random').length < randomLines; lineNo += step) picks.push({ section: 'random', line: lineNo, text: lines[lineNo - 1] ?? '' });
  }
  const limited = limitArrayByJsonBytes(picks, maxBytes);
  return ok(`sampled ${resolved.relative}`, { path: resolved.relative, total_lines: lines.length, file_hash: sha256(text), samples: limited.value, truncated: limited.truncated });
}

export async function readFileChunk(config: AppConfig, workspace: Workspace, requestedPath: string, offset = 0, maxBytes = DEFAULT_MAX_BYTES) {
  const resolved = await resolveInside(workspace, requestedPath, config);
  const info = await stat(resolved.absolute);
  if (!info.isFile()) throw new Error('path is not a file');
  const fh = await import('node:fs/promises').then((fs) => fs.open(resolved.absolute, 'r'));
  try {
    const size = Math.min(Math.max(1, maxBytes), 250_000);
    const buffer = Buffer.alloc(size);
    const read = await fh.read(buffer, 0, size, Math.max(0, offset));
    const bytes = buffer.subarray(0, read.bytesRead);
    if (bytes.includes(0)) throw new Error('binary file refused');
    return ok(`read chunk ${resolved.relative}`, { path: resolved.relative, offset: Math.max(0, offset), bytes: bytes.length, next_offset: Math.max(0, offset) + bytes.length, eof: Math.max(0, offset) + bytes.length >= info.size, total_bytes: info.size, file_hash: await fileSha256(resolved.absolute), text: TEXT_DECODER.decode(bytes) });
  } finally { await fh.close(); }
}

export async function readFileLinesLarge(config: AppConfig, workspace: Workspace, requestedPath: string, startLine = 1, maxLines = 200) {
  const resolved = await resolveInside(workspace, requestedPath, config);
  const text = await readBoundedText(resolved.absolute, MAX_SCAN_BYTES);
  const lines = text.split(/\r?\n/);
  const start = Math.max(1, startLine) - 1;
  const selected = lines.slice(start, start + Math.min(maxLines, 2000));
  return ok(`read lines ${resolved.relative}`, { path: resolved.relative, start_line: start + 1, end_line: start + selected.length, total_lines: lines.length, truncated: start + selected.length < lines.length, next_line: start + selected.length + 1, file_hash: sha256(text), text: selected.join('\n') });
}

export async function readAround(config: AppConfig, workspace: Workspace, requestedPath: string, line: number, before = 10, after = 20) {
  return readFileLinesLarge(config, workspace, requestedPath, Math.max(1, line - before), before + after + 1);
}

export async function searchFile(config: AppConfig, workspace: Workspace, requestedPath: string, query: string, maxMatches = 50, contextLines = 0) {
  const resolved = await resolveInside(workspace, requestedPath, config);
  const text = await readBoundedText(resolved.absolute, MAX_SCAN_BYTES);
  return ok(`searched ${resolved.relative}`, { path: resolved.relative, query, file_hash: sha256(text), ...searchLines(text, query, maxMatches, contextLines) });
}

export async function searchFiles(config: AppConfig, workspace: Workspace, rootPath: string, query: string, glob = '**/*', maxMatches = 50, contextLines = 0) {
  const root = await resolveInside(workspace, rootPath, config);
  const hits: Array<Record<string, unknown>> = [];
  for await (const file of walkFiles(root.absolute, root.relative)) {
    if (hits.length >= Math.min(maxMatches, MAX_MATCHES)) break;
    if (!globMatch(file.relative, glob)) continue;
    let text = '';
    try { text = await readBoundedText(file.absolute, Math.min(MAX_SCAN_BYTES, 5_000_000)); } catch { continue; }
    const result = searchLines(text, query, Math.min(maxMatches, MAX_MATCHES) - hits.length, contextLines);
    for (const match of result.matches) hits.push({ path: file.relative, ...match });
  }
  return ok(`searched files under ${root.relative}`, { root: root.relative, query, glob, matches: hits, truncated: hits.length >= Math.min(maxMatches, MAX_MATCHES) });
}

export async function tableProfile(config: AppConfig, workspace: Workspace, requestedPath: string, columns?: string[]) {
  const { resolved, rows, headers } = await readTable(config, workspace, requestedPath);
  const selected = columns?.length ? headers.filter((h) => columns.includes(h)) : headers;
  const profiles = selected.map((column) => profileColumn(rows, column));
  return ok(`profiled table ${resolved.relative}`, { path: resolved.relative, row_count: rows.length, columns: headers, profiles });
}

export async function queryTable(config: AppConfig, workspace: Workspace, requestedPath: string, select?: string[], where?: FilterSpec, sort?: Array<Record<string, string>>, limit = 100, offset = 0) {
  const { resolved, rows, headers } = await readTable(config, workspace, requestedPath);
  let out = rows.filter((row) => matchesWhere(row, where));
  out = sortRows(out, sort);
  const total = out.length;
  const fields = select?.length ? select : headers;
  out = out.slice(Math.max(0, offset), Math.max(0, offset) + Math.min(limit, 1000)).map((row) => pick(row, fields));
  return ok(`queried table ${resolved.relative}`, { path: resolved.relative, total, offset, limit: Math.min(limit, 1000), rows: out, truncated: Math.max(0, offset) + out.length < total, next_offset: Math.max(0, offset) + out.length });
}

export async function queryTableAggregate(config: AppConfig, workspace: Workspace, requestedPath: string, groupBy: string[] = [], metrics: Array<Record<string, string>> = [{ op: 'count' }], where?: FilterSpec) {
  const { resolved, rows } = await readTable(config, workspace, requestedPath);
  const groups = new Map<string, Row[]>();
  for (const row of rows.filter((r) => matchesWhere(r, where))) {
    const key = JSON.stringify(groupBy.map((field) => row[field] ?? ''));
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const result = [...groups.entries()].map(([key, items]) => {
    const values = JSON.parse(key) as string[];
    const base: Record<string, unknown> = {};
    groupBy.forEach((field, i) => { base[field] = values[i]; });
    for (const metric of metrics) Object.assign(base, aggregate(items, metric));
    return base;
  });
  return ok(`aggregated table ${resolved.relative}`, { path: resolved.relative, group_by: groupBy, groups: result, total_groups: result.length });
}

export async function jsonProfile(config: AppConfig, workspace: Workspace, requestedPath: string, depth = 3, arraySamples = 3) {
  const resolved = await resolveInside(workspace, requestedPath, config);
  const json = JSON.parse(await readBoundedText(resolved.absolute, MAX_SCAN_BYTES));
  return ok(`profiled json ${resolved.relative}`, { path: resolved.relative, file_hash: await fileSha256(resolved.absolute), ...profileJsonValue(json, Math.min(depth, 6), Math.min(arraySamples, 20), '$') });
}

export async function queryJson(config: AppConfig, workspace: Workspace, requestedPath: string, query: string, maxBytes = DEFAULT_MAX_BYTES) {
  const resolved = await resolveInside(workspace, requestedPath, config);
  const json = JSON.parse(await readBoundedText(resolved.absolute, MAX_SCAN_BYTES));
  const value = evalJsonPath(json, query);
  const limited = limitJsonBytes(value, Math.min(maxBytes, 250_000));
  return ok(`queried json ${resolved.relative}`, { path: resolved.relative, query, value: limited.value, truncated: limited.truncated });
}

export async function patchFileLines(config: AppConfig, workspace: Workspace, requestedPath: string, startLine: number, endLine: number, replacement: string, expectedSha256?: string, dryRun = true) {
  const resolved = await resolveWritableInside(workspace, requestedPath, config);
  const text = await readBoundedText(resolved.absolute, MAX_SCAN_BYTES);
  const hash = sha256(text);
  if (expectedSha256 && expectedSha256 !== hash) throw new Error('expected_sha256 does not match current file');
  const lines = text.split(/\r?\n/);
  const start = Math.max(1, startLine) - 1;
  const end = Math.max(startLine, endLine);
  const replacementLines = replacement.split(/\r?\n/);
  const next = [...lines.slice(0, start), ...replacementLines, ...lines.slice(end)].join('\n');
  if (!dryRun) await writeFile(resolved.absolute, next, 'utf8');
  return ok(`${dryRun ? 'dry run patch' : 'patched'} ${resolved.relative}`, { path: resolved.relative, dry_run: dryRun, file_hash_before: hash, file_hash_after: sha256(next), line_range: { start_line: startLine, end_line: endLine }, preview: { before: lines.slice(start, end), after: replacementLines } });
}

export async function updateTableRows(config: AppConfig, workspace: Workspace, requestedPath: string, where: FilterSpec, setValues: Record<string, string>, dryRun = true, allowMultiple = false) {
  const resolved = await resolveWritableInside(workspace, requestedPath, config);
  const text = await readBoundedText(resolved.absolute, MAX_SCAN_BYTES);
  const delimiter = detectDelimiter(requestedPath, text);
  const lines = text.split(/\r?\n/);
  const headers = splitDelimited(lines[0] ?? '', delimiter);
  const rows = lines.slice(1).filter((line) => line.length).map((line, index) => ({ index, row: rowFromLine(headers, line, delimiter) }));
  const matched = rows.filter(({ row }) => matchesWhere(row, where));
  if (!allowMultiple && matched.length > 1) throw new Error(`ambiguous update matched ${matched.length} rows; set allow_multiple=true`);
  const nextLines = [...lines];
  for (const item of matched) {
    const updated = { ...item.row, ...setValues };
    nextLines[item.index + 1] = headers.map((h) => escapeCell(updated[h] ?? '', delimiter)).join(delimiter);
  }
  const next = nextLines.join('\n');
  if (!dryRun) await writeFile(resolved.absolute, next, 'utf8');
  return ok(`${dryRun ? 'dry run update' : 'updated'} table rows`, { path: resolved.relative, dry_run: dryRun, matched_rows: matched.length, line_numbers: matched.map((m) => m.index + 2), file_hash_before: sha256(text), file_hash_after: sha256(next), set: setValues });
}

async function fileMeta(absolute: string) { const info = await stat(absolute); return { type: info.isDirectory() ? 'dir' : info.isFile() ? 'file' : 'other', size: info.size, modified_at: info.mtime.toISOString(), media_type: mediaType(absolute), sha256: info.isFile() ? await fileSha256(absolute) : undefined }; }
async function readSampleBytes(file: string, bytes: number) { const raw = await readFile(file); const slice = raw.subarray(0, bytes); if (slice.includes(0)) throw new Error('binary file refused'); return { text: TEXT_DECODER.decode(slice) }; }
async function readBoundedText(file: string, maxBytes: number) { const info = await stat(file); if (!info.isFile()) throw new Error('path is not a file'); if (info.size > maxBytes) throw new Error(`file exceeds large-file scan limit: ${info.size}`); const raw = await readFile(file); if (raw.includes(0)) throw new Error('binary file refused'); return raw.toString('utf8'); }
async function fileSha256(file: string) { return sha256(await readFile(file)); }
function sha256(input: string | Buffer) { return createHash('sha256').update(input).digest('hex'); }
function detectTextType(file: string, text: string) { const ext = path.extname(file).toLowerCase(); if (ext === '.json') return 'json'; if (ext === '.jsonl') return 'jsonl'; if (ext === '.tsv') return 'tsv'; if (ext === '.csv') return 'csv'; if (ext === '.html' || ext === '.htm') return 'html'; if (ext === '.md') return 'markdown'; const first = text.trimStart()[0]; if (first === '{' || first === '[') return 'json'; if (text.split('\n').slice(0, 5).some((l) => l.includes('\t'))) return 'tsv'; return 'text'; }
function detectDelimiter(file: string, text: string) { return path.extname(file).toLowerCase() === '.csv' ? ',' : text.split('\n')[0]?.includes('\t') ? '\t' : ','; }
function tableStructure(text: string, delimiter: string) { const lines = text.split(/\r?\n/).filter(Boolean); const headers = splitDelimited(lines[0] ?? '', delimiter); return { delimiter: delimiter === '\t' ? 'tab' : 'comma', headers, sample_rows: lines.slice(1, 6).map((l) => rowFromLine(headers, l, delimiter)) }; }
function safeJsonProfile(text: string, depth: number, samples: number) { try { return profileJsonValue(JSON.parse(text), depth, samples, '$'); } catch (error) { return { json_parse_error: error instanceof Error ? error.message : String(error) }; } }
function safeParseJson(text: string) { try { return JSON.parse(text); } catch { return null; } }
function splitDelimited(line: string, delimiter: string) { const out: string[] = []; let cur = ''; let quoted = false; for (let i = 0; i < line.length; i++) { const ch = line[i]; if (ch === '"') { if (quoted && line[i + 1] === '"') { cur += '"'; i++; } else quoted = !quoted; } else if (ch === delimiter && !quoted) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out; }
function rowFromLine(headers: string[], line: string, delimiter: string): Row { const cells = splitDelimited(line, delimiter); return Object.fromEntries(headers.map((h, i) => [h, cells[i] ?? ''])); }
async function readTable(config: AppConfig, workspace: Workspace, requestedPath: string) { const resolved = await resolveInside(workspace, requestedPath, config); const text = await readBoundedText(resolved.absolute, MAX_SCAN_BYTES); const delimiter = detectDelimiter(resolved.relative, text); const lines = text.split(/\r?\n/).filter((l) => l.length); const headers = splitDelimited(lines[0] ?? '', delimiter); const rows = lines.slice(1).map((l) => rowFromLine(headers, l, delimiter)); return { resolved, rows, headers, delimiter }; }
function searchLines(text: string, query: string, maxMatches: number, contextLines: number) { const q = query.toLowerCase(); const lines = text.split(/\r?\n/); const matches = []; for (let i = 0; i < lines.length && matches.length < Math.min(maxMatches, MAX_MATCHES); i++) if (lines[i].toLowerCase().includes(q)) matches.push({ line: i + 1, text: lines[i], context: contextLines ? lines.slice(Math.max(0, i - contextLines), i + contextLines + 1).map((text, j) => ({ line: Math.max(1, i - contextLines + 1) + j, text })) : undefined }); return { matches, total_lines: lines.length, truncated: matches.length >= Math.min(maxMatches, MAX_MATCHES) }; }
async function* walkFiles(absoluteRoot: string, relativeRoot: string): AsyncGenerator<{ absolute: string; relative: string }> { const entries = await readdir(absoluteRoot, { withFileTypes: true }).catch(() => []); for (const entry of entries) { if (SKIP_DIRS.has(entry.name)) continue; const absolute = path.join(absoluteRoot, entry.name); const relative = relativeRoot === '.' ? entry.name : path.posix.join(relativeRoot, entry.name); if (entry.isDirectory()) yield* walkFiles(absolute, relative); else if (entry.isFile()) yield { absolute, relative }; } }
function globMatch(file: string, glob: string) { if (!glob || glob === '**/*') return true; const exts = glob.match(/\{([^}]+)\}/)?.[1]?.split(',').map((e) => '.' + e.replace(/^\*?\.?/, '')); if (exts) return exts.includes(path.extname(file)); return file.includes(glob.replaceAll('*', '').replaceAll('/', '')); }
function profileColumn(rows: Row[], column: string) { const values = rows.map((r) => r[column] ?? ''); const nonBlank = values.filter((v) => v.trim()); const counts = new Map<string, number>(); for (const v of nonBlank) counts.set(v, (counts.get(v) ?? 0) + 1); const nums = nonBlank.map((v) => Number(v.replace('%', ''))).filter(Number.isFinite); return { column, blanks: values.length - nonBlank.length, distinct: counts.size, top_values: [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([value, count]) => ({ value, count })), numeric_min: nums.length ? Math.min(...nums) : undefined, numeric_max: nums.length ? Math.max(...nums) : undefined, numeric_avg: nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : undefined }; }
function matchesWhere(row: Row, where?: FilterSpec) { if (!where) return true; return Object.entries(where).every(([field, expected]) => { const actual = row[field] ?? ''; if (expected && typeof expected === 'object' && !Array.isArray(expected)) { const spec = expected as Record<string, unknown>; if (spec.in && Array.isArray(spec.in)) return spec.in.map(String).includes(actual); if (spec.gte !== undefined && actual < String(spec.gte)) return false; if (spec.lte !== undefined && actual > String(spec.lte)) return false; if (spec.contains !== undefined) return actual.toLowerCase().includes(String(spec.contains).toLowerCase()); return true; } return actual === String(expected); }); }
function sortRows(rows: Row[], sort?: Array<Record<string, string>>) { if (!sort?.length) return rows; return [...rows].sort((a, b) => { for (const item of sort) { const field = item.field ?? item.column ?? ''; const dir = item.direction === 'desc' ? -1 : 1; const cmp = String(a[field] ?? '').localeCompare(String(b[field] ?? ''), undefined, { numeric: true }); if (cmp) return cmp * dir; } return 0; }); }
function pick(row: Row, fields: string[]) { return Object.fromEntries(fields.map((f) => [f, row[f] ?? ''])); }
function aggregate(rows: Row[], metric: Record<string, string>) { const op = metric.op ?? 'count'; const column = metric.column ?? ''; const key = column ? `${op}_${column}` : op; if (op === 'count') return { [key]: rows.length }; const nums = rows.map((r) => Number((r[column] ?? '').replace('%', ''))).filter(Number.isFinite); if (op === 'sum') return { [key]: nums.reduce((a, b) => a + b, 0) }; if (op === 'avg') return { [key]: nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null }; if (op === 'min') return { [key]: nums.length ? Math.min(...nums) : null }; if (op === 'max') return { [key]: nums.length ? Math.max(...nums) : null }; return { [key]: null }; }
function profileJsonValue(value: unknown, depth: number, arraySamples: number, jsonPath: string): Record<string, unknown> { const type = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value; if (depth <= 0) return { type, path: jsonPath }; if (Array.isArray(value)) return { type, path: jsonPath, length: value.length, samples: value.slice(0, arraySamples).map((v, i) => profileJsonValue(v, depth - 1, arraySamples, `${jsonPath}[${i}]`)) }; if (value && typeof value === 'object') { const entries = Object.entries(value as Record<string, unknown>); return { type, path: jsonPath, keys: entries.map(([k]) => k), children: Object.fromEntries(entries.slice(0, 50).map(([k, v]) => [k, profileJsonValue(v, depth - 1, arraySamples, `${jsonPath}.${k}`)])) }; } return { type, path: jsonPath, sample: value }; }
function evalJsonPath(root: unknown, query: string): unknown {
  let q = query.trim();
  if (q.startsWith('$.')) q = q.slice(2);
  else if (q === '$') return root;
  else if (q.startsWith('.')) q = q.slice(1);
  const parts = splitJsonPath(q);
  return evalJsonPathParts(root, parts);
}

function evalJsonPathParts(current: unknown, parts: string[]): unknown {
  if (parts.length === 0) return current;
  const [part, ...rest] = parts;
  const inlineProjection = part.match(/^([^[]+)\[\*\]\.?\{(.+)\}$/);
  const braceProjection = part.match(/^\{(.+)\}$/);
  if (inlineProjection || (braceProjection && Array.isArray(current))) {
    const arr = inlineProjection ? (current as Record<string, unknown>)?.[inlineProjection[1]] : current;
    if (!Array.isArray(arr)) return undefined;
    const source = inlineProjection?.[2] ?? braceProjection?.[1] ?? '';
    const fields = source.split(',').map((item) => item.trim()).filter(Boolean).map((item) => {
      const [alias, field] = item.split(':').map((x) => x.trim());
      return { alias: field ? alias : alias, field: field ?? alias };
    });
    const mapped = arr.map((item) => Object.fromEntries(fields.map(({ alias, field }) => [alias, (item as Record<string, unknown>)?.[field]])));
    return evalJsonPathParts(mapped, rest);
  }
  const wildcard = part.match(/^([^[]+)\[\*\]$/);
  if (wildcard) {
    const arr = (current as Record<string, unknown>)?.[wildcard[1]];
    if (!Array.isArray(arr)) return undefined;
    if (rest[0]?.startsWith('{')) return evalJsonPathParts(arr, rest);
    return rest.length ? arr.map((item) => evalJsonPathParts(item, rest)) : arr;
  }
  const m = part.match(/^([^[]+)(?:\[(\d+)(?::(\d+))?\])?$/);
  if (!m) throw new Error(`unsupported json query segment: ${part}`);
  let next = (current as Record<string, unknown>)?.[m[1]];
  if (m[2] !== undefined) {
    if (!Array.isArray(next)) return undefined;
    next = m[3] !== undefined ? next.slice(Number(m[2]), Number(m[3])) : next[Number(m[2])];
  }
  return evalJsonPathParts(next, rest);
}

function splitJsonPath(query: string): string[] {
  const parts: string[] = [];
  let current = '';
  let braceDepth = 0;
  for (const ch of query) {
    if (ch === '{') braceDepth++;
    if (ch === '}') braceDepth--;
    if (ch === '.' && braceDepth === 0) { if (current) parts.push(current); current = ''; }
    else current += ch;
  }
  if (current) parts.push(current);
  return parts;
}

function limitJsonBytes(value: unknown, maxBytes: number) {
  const raw = JSON.stringify(value);
  if (Buffer.byteLength(raw) <= maxBytes) return { value, truncated: false };
  return { value: typeof value === 'string' ? value.slice(0, maxBytes) : { omitted: true, reason: 'value exceeded max_bytes', bytes: Buffer.byteLength(raw) }, truncated: true };
}

function limitArrayByJsonBytes<T>(items: T[], maxBytes: number) {
  const out: T[] = [];
  for (const item of items) {
    const next = [...out, item];
    if (Buffer.byteLength(JSON.stringify(next)) > maxBytes) return { value: out, truncated: true };
    out.push(item);
  }
  return { value: out, truncated: false };
}
function escapeCell(value: string, delimiter: string) { return value.includes(delimiter) || value.includes('"') || value.includes('\n') ? `"${value.replaceAll('"', '""')}"` : value; }
