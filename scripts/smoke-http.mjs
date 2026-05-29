import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = await mkdtemp(path.join(tmpdir(), 'ota-http-smoke-'));
await writeFile(path.join(root, 'README.md'), '# HTTP Smoke\nhello http mcp\n');
const config = path.join(root, 'config.yaml');
const port = 19000 + Math.floor(Math.random() * 1000);
await writeConfig(config, root, port);

const child = spawn('node', ['dist/index.js', '--config', config, '--transport', 'http'], { stdio: ['ignore', 'ignore', 'pipe'] });
child.stderr.on('data', () => {});

try {
  await waitForHealth(port);
  const sessionId = await initialize(port);
  const tools = await rpc(port, 2, 'tools/list', {}, sessionId);
  const read = await rpc(port, 3, 'tools/call', { name: 'read_file', arguments: { workspace_id: 'smoke', path: 'README.md' } }, sessionId);
  const text = JSON.stringify({ tools, read });
  if (!text.includes('read_file') || !text.includes('hello http mcp')) throw new Error(text);
  console.log('http smoke ok');
} finally {
  child.kill('SIGTERM');
}

async function writeConfig(file, workspaceRoot, port) {
  await writeFile(file, `server:\n  host: 127.0.0.1\n  port: ${port}\nworkspaces:\n  - id: smoke\n    name: Smoke\n    root: ${JSON.stringify(workspaceRoot)}\n    allow_read: true\n    allow_patch: true\nsecurity:\n  max_file_bytes: 200000\n  max_response_bytes: 50000\n  max_search_results: 10\n  denied_globs: []\n`);
}

async function initialize(port) {
  const result = await rpc(port, 1, 'initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'http-smoke', version: '0.0.0' } });
  if (!result.sessionId) throw new Error('missing MCP session id');
  return result.sessionId;
}

async function rpc(port, id, method, params, sessionId) {
  const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
  if (sessionId) headers['mcp-session-id'] = sessionId;
  const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params })
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status}: ${text}`);
  return { ...parseResponse(text), sessionId: res.headers.get('mcp-session-id') ?? sessionId };
}

function parseResponse(text) {
  const data = text.split('\n').find((line) => line.startsWith('data: '));
  return JSON.parse(data ? data.slice(6) : text);
}

async function waitForHealth(port) {
  for (let i = 0; i < 50; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/healthz`);
      if (res.ok && (await res.text()).includes('ota-computer-use-gateway')) return;
    } catch {}
    await delay(100);
  }
  throw new Error('http server did not become healthy');
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
