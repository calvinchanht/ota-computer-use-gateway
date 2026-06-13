import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

if (process.platform !== 'win32') {
  console.log('windows computer smoke skipped: Windows host required');
  process.exit(0);
}

const root = await mkdtemp(path.join(tmpdir(), 'ota-windows-computer-smoke-'));
const port = 21000 + Math.floor(Math.random() * 1000);
const config = path.join(root, 'config.yaml');
await writeConfig(config, root, port);

const child = spawn('node', ['dist/index.js', '--config', config, '--transport', 'http'], { stdio: ['ignore', 'ignore', 'pipe'] });
child.stderr.on('data', () => {});

try {
  await waitForHealth(port);
  const sessionId = await initialize(port);
  await exercisePolicy(port, sessionId);
  await exerciseStatus(port, sessionId);
  await exerciseObservation(port, sessionId);
  await exerciseLaunch(port, sessionId);
  console.log('windows computer non-screenshot smoke ok');
} finally {
  child.kill('SIGTERM');
}

async function exercisePolicy(port, sessionId) {
  const policy = await toolData(port, sessionId, 'get_workspace_policy', { workspace_id: 'windows-smoke' });
  expectIncludes(policy.allowed_tools, 'windows_list_monitors', 'policy');
  expectIncludes(policy.allowed_tools, 'windows_uia_tree', 'policy');
  expectIncludes(policy.allowed_tools, 'windows_launch_app', 'policy');
  expectExcludes(policy.allowed_tools, 'windows_screenshot', 'policy');
  expectExcludes(policy.allowed_tools, 'windows_click', 'policy');
}

async function exerciseStatus(port, sessionId) {
  const status = await toolData(port, sessionId, 'windows_computer_status', { workspace_id: 'windows-smoke' });
  if (!status.host_supported) throw new Error('windows_computer_status did not report host_supported=true');
  if (status.capabilities.allow_screenshot) throw new Error('smoke lane must not enable screenshot capture');
}

async function exerciseObservation(port, sessionId) {
  const monitors = await toolData(port, sessionId, 'windows_list_monitors', { workspace_id: 'windows-smoke' });
  if (!JSON.stringify(monitors).includes('bounds')) throw new Error('windows_list_monitors returned no bounds');
  const windows = await toolData(port, sessionId, 'windows_list_windows', { workspace_id: 'windows-smoke' });
  if (!JSON.stringify(windows).includes('hwnd')) throw new Error('windows_list_windows returned no hwnd');
  const tree = await toolData(port, sessionId, 'windows_uia_tree', { workspace_id: 'windows-smoke', max_nodes: 20 });
  if (!Array.isArray(tree.nodes) || tree.nodes.length === 0) throw new Error('windows_uia_tree returned no nodes');
}

async function exerciseLaunch(port, sessionId) {
  const launched = await toolData(port, sessionId, 'windows_launch_app', { workspace_id: 'windows-smoke', file_path: 'cmd.exe', args: ['/c', 'exit'] });
  if (!Number.isInteger(launched.pid)) throw new Error('windows_launch_app returned no integer pid');
}

async function writeConfig(file, workspaceRoot, port) {
  await writeFile(file, `server:\n  host: 127.0.0.1\n  port: ${port}\nworkspaces:\n  - id: windows-smoke\n    name: Windows Smoke\n    root: ${JSON.stringify(workspaceRoot)}\n    allow_read: true\n    allow_write: false\n    allow_patch: false\n    allow_tests: false\n    windows_computer:\n      enabled: true\n      allow_screenshot: false\n      allow_uia_tree: true\n      allow_mouse: false\n      allow_keyboard: false\n      allow_clipboard: false\n      allow_window_management: true\n      allow_app_launch: true\n      allow_process_attach: false\n      allow_multi_monitor: true\nsecurity:\n  max_file_bytes: 200000\n  max_response_bytes: 50000\n  max_search_results: 10\n  max_exec_ms: 10000\n  denied_globs: []\n`);
}

async function toolData(port, sessionId, name, args) {
  const result = await call(port, sessionId, name, args);
  const payload = JSON.parse(result.result.content[0].text);
  if (payload.ok === false) throw new Error(`${name} failed: ${payload.message}`);
  return payload.data;
}

async function initialize(port) {
  const result = await rpc(port, 1, 'initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'windows-computer-smoke', version: '0.0.0' } });
  return result.sessionId;
}

async function call(port, sessionId, name, args) {
  return rpc(port, nextId(), 'tools/call', { name, arguments: args }, sessionId);
}

async function rpc(port, id, method, params, sessionId) {
  const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
  if (sessionId) headers['mcp-session-id'] = sessionId;
  const res = await fetch(`http://127.0.0.1:${port}/mcp`, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id, method, params }) });
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

function expectIncludes(items, expected, label) {
  if (!items.includes(expected)) throw new Error(`${label} missing ${expected}`);
}

function expectExcludes(items, expected, label) {
  if (items.includes(expected)) throw new Error(`${label} unexpectedly includes ${expected}`);
}

function nextId() {
  nextId.value = (nextId.value ?? 1) + 1;
  return nextId.value;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
