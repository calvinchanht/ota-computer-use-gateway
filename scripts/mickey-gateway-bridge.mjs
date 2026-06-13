#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

const DEFAULT_BASE_URL = 'https://mickey-api.unrealize.com';
const DEFAULT_TOKEN_FILE = '/home/genesis/secrets/ota-computer-use-gateway/mickey-bearer-token';
const DEFAULT_THREAD = {
  provider: 'chatgpt',
  project_id: 'g-p-6a1cac252ea88191a6d0e6522a429765-mickey',
  thread_id: '6a1cad6a-6ae8-8329-b312-eddfa767ac30',
  thread_url: 'https://chatgpt.com/g/g-p-6a1cac252ea88191a6d0e6522a429765-mickey/c/6a1cad6a-6ae8-8329-b312-eddfa767ac30'
};

const args = parseArgs(process.argv.slice(2));
const baseUrl = args.baseUrl ?? process.env.MICKEY_GATEWAY_BASE_URL ?? DEFAULT_BASE_URL;
const token = await loadToken(args.tokenFile ?? process.env.MICKEY_GATEWAY_TOKEN_FILE ?? DEFAULT_TOKEN_FILE);
if (args.intentFile) {
  const packet = JSON.parse(await readFile(args.intentFile, 'utf8'));
  const calls = Array.isArray(packet.calls) ? packet.calls : [];
  if (calls.length === 0) throw new Error('intent file requires a calls array');
  args.mode = 'batch';
  args.steps = JSON.stringify(calls.map((call) => ({ tool: call.tool, arguments: call.arguments ?? {} })));
  args.idempotencyKey ??= packet.idempotency_key;
  args.thread ??= packet.thread ? JSON.stringify(packet.thread) : undefined;
}

const mode = args.mode ?? (args.steps ? 'batch' : 'tool');

if (args.getRun) {
  const result = await requestJson(`${baseUrl}/api/v1/runs/${encodeURIComponent(args.getRun)}`, { method: 'GET', token });
  await outputResult(result, args);
  process.exit(result.ok ? 0 : 1);
}

const thread = args.thread ? JSON.parse(args.thread) : DEFAULT_THREAD;
const idempotencyKey = args.idempotencyKey ?? `mickey-bridge-${randomUUID()}`;

if (mode === 'batch') {
  const steps = args.steps ? JSON.parse(args.steps) : defaultSteps();
  const result = await requestJson(`${baseUrl}/api/v1/batch`, {
    method: 'POST',
    token,
    body: { thread, steps, idempotency_key: idempotencyKey }
  });
  await outputResult(result, args);
  process.exit(result.ok ? 0 : 1);
}

const tool = args.tool ?? 'workspace_status';
const toolArgs = args.arguments ? JSON.parse(args.arguments) : {};
const result = await requestJson(`${baseUrl}/api/v1/tool`, {
  method: 'POST',
  token,
  body: { thread, tool, arguments: toolArgs, idempotency_key: idempotencyKey }
});
await outputResult(result, args);
process.exit(result.ok ? 0 : 1);

function defaultSteps() {
  return [
    { tool: 'workspace_status', arguments: {} },
    { tool: 'list_dir', arguments: { workspace_id: 'mickey', path: 'chatgpt-projects/mickey', max_entries: 10 } },
    { tool: 'git_status', arguments: { workspace_id: 'mickey' } }
  ];
}

async function requestJson(url, { method, token, body }) {
  const res = await fetch(url, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(body?.idempotency_key ? { 'idempotency-key': body.idempotency_key } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = { ok: false, summary: text }; }
  if (!res.ok) throw new Error(`${res.status}: ${JSON.stringify(parsed)}`);
  return parsed;
}

async function loadToken(file) {
  const token = (await readFile(file, 'utf8')).trim();
  if (!token) throw new Error(`empty token file: ${file}`);
  return token;
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--batch') out.mode = 'batch';
    else if (arg === '--tool') out.tool = required(argv, ++i, arg);
    else if (arg === '--arguments') out.arguments = required(argv, ++i, arg);
    else if (arg === '--steps') out.steps = required(argv, ++i, arg);
    else if (arg === '--intent-file') out.intentFile = required(argv, ++i, arg);
    else if (arg === '--thread') out.thread = required(argv, ++i, arg);
    else if (arg === '--idempotency-key') out.idempotencyKey = required(argv, ++i, arg);
    else if (arg === '--get-run') out.getRun = required(argv, ++i, arg);
    else if (arg === '--format') out.format = required(argv, ++i, arg);
    else if (arg === '--output-file') out.outputFile = required(argv, ++i, arg);
    else if (arg === '--base-url') out.baseUrl = required(argv, ++i, arg);
    else if (arg === '--token-file') out.tokenFile = required(argv, ++i, arg);
    else if (arg === '--help') usage();
    else throw new Error(`unknown argument: ${arg}`);
  }
  return out;
}

function required(argv, index, flag) {
  const value = argv[index];
  if (!value) throw new Error(`${flag} requires a value`);
  return value;
}

async function outputResult(result, args) {
  const text = formatResult(result, args.format);
  if (args.outputFile) {
    await mkdir(path.dirname(args.outputFile), { recursive: true });
    await writeFile(args.outputFile, `${text}\n`);
  }
  console.log(text);
}

function formatResult(result, format = 'json') {
  const safe = safeResult(result);
  if (format === 'chat') return chatSummary(safe);
  if (format !== 'json') throw new Error(`unsupported format: ${format}`);
  return JSON.stringify(safe, null, 2);
}

function safeResult(result) {
  const summary = {
    ok: result.ok,
    summary: result.summary,
    api: result.api ?? (result.run ? { run_id: result.run.run_id, status: result.run.status } : undefined),
    data: result.data ?? (result.run ? { kind: result.run.kind, request: result.run.request, response: result.run.response } : undefined)
  };
  return summary;
}

function chatSummary(result) {
  const lines = [];
  lines.push(`Gateway run ${result.ok ? 'succeeded' : 'failed'}: ${result.summary ?? '(no summary)'}`);
  if (result.api?.run_id) lines.push(`run_id: ${result.api.run_id}`);
  const rows = result.data?.results;
  if (Array.isArray(rows)) {
    lines.push('results:');
    for (const row of rows) {
      const r = row.result ?? {};
      lines.push(`- ${row.tool}: ${r.ok ? 'ok' : 'failed'} — ${r.summary ?? ''}`.trim());
      const text = r.data?.text;
      if (typeof text === 'string') lines.push(indentBlock(excerpt(text, 1200)));
      const stdout = r.data?.stdout;
      if (typeof stdout === 'string' && stdout.trim()) lines.push(indentBlock(excerpt(stdout.trim(), 800)));
      const entries = r.data?.entries;
      if (Array.isArray(entries)) lines.push(indentBlock(entries.slice(0, 20).map((entry) => `- ${entry.name} (${entry.type})`).join('\n')));
    }
  } else if (result.data?.text) {
    lines.push(indentBlock(excerpt(result.data.text, 1600)));
  } else if (result.data) {
    lines.push('data:');
    lines.push(indentBlock(excerpt(JSON.stringify(result.data, null, 2), 2000)));
  }
  return lines.filter(Boolean).join('\n');
}

function excerpt(text, max) {
  return text.length > max ? `${text.slice(0, max)}… [truncated ${text.length - max} chars]` : text;
}

function indentBlock(text) {
  return text.split('\n').map((line) => `  ${line}`).join('\n');
}


function usage() {
  console.log(`Usage:
  node scripts/mickey-gateway-bridge.mjs [--tool workspace_status] [--arguments '{...}']
  node scripts/mickey-gateway-bridge.mjs --batch [--steps '[...]']
  node scripts/mickey-gateway-bridge.mjs --intent-file bridge-intent.json
  node scripts/mickey-gateway-bridge.mjs --get-run <run_id>
  node scripts/mickey-gateway-bridge.mjs --intent-file bridge-intent.json --format chat
  node scripts/mickey-gateway-bridge.mjs --intent-file bridge-intent.json --format chat --output-file .agent/bridge/latest-response.md

Environment:
  MICKEY_GATEWAY_BASE_URL    Defaults to ${DEFAULT_BASE_URL}
  MICKEY_GATEWAY_TOKEN_FILE  Defaults to ${DEFAULT_TOKEN_FILE}
`);
  process.exit(0);
}
