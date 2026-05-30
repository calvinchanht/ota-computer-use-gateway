import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = await mkdtemp(path.join(tmpdir(), 'ota-primitives-smoke-'));
const port = 20000 + Math.floor(Math.random() * 1000);
const config = path.join(root, 'config.yaml');
await seedWorkspace(root);
await writeConfig(config, root, port);

const child = spawn('node', ['dist/index.js', '--config', config, '--transport', 'http'], { stdio: ['ignore', 'ignore', 'pipe'] });
child.stderr.on('data', () => {});

try {
  await waitForHealth(port);
  const sessionId = await initialize(port);
  await call(port, sessionId, 'get_tool_profile', {});
  await expectText(port, sessionId, 'list_browser_profiles', { workspace_id: 'smoke' }, 'Close unused tabs.');
  await expectText(port, sessionId, 'browser_status', { workspace_id: 'smoke' }, '127.0.0.1:9222');
  await expectText(port, sessionId, 'computer_status', { workspace_id: 'smoke' }, 'observe_after');
  await exerciseFiles(port, sessionId);
  await exerciseContext(port, sessionId);
  await exerciseSkills(port, sessionId);
  await exerciseCommand(port, sessionId);
  await exerciseProcess(port, sessionId);
  console.log('primitive smoke ok');
} finally {
  child.kill('SIGTERM');
}

async function seedWorkspace(rootDir) {
  await writeFile(path.join(rootDir, 'README.md'), '# Primitive Smoke\nhello primitive mcp\n');
  await mkdir(path.join(rootDir, '.agent/skills/smoke-skill'), { recursive: true });
  await writeFile(path.join(rootDir, '.agent/AGENT_START_HERE.md'), 'Smoke agent start here: call bootstrap first.\n');
  await writeFile(path.join(rootDir, '.agent/PROVIDER_THREAD_PROMPT.md'), 'Smoke provider thread prompt.\n');
  await writeFile(path.join(rootDir, '.agent/SOUL.md'), 'Smoke soul: act like an OpenClaw-style workspace agent.\n');
  await writeFile(path.join(rootDir, '.agent/USER.md'), 'Smoke user context.\n');
  await writeFile(path.join(rootDir, '.agent/TOOLS.md'), 'Smoke tools context.\n');
  await writeFile(path.join(rootDir, '.agent/ESTATE_CONTEXT.md'), 'Smoke estate context.\n');
  await writeFile(path.join(rootDir, '.agent/skills/smoke-skill/SKILL.md'), '# Smoke Skill\n\ndescription: Smoke skill metadata.\n\nUse smoke skills.\n');
}

async function exerciseFiles(port, sessionId) {
  await call(port, sessionId, 'list_dir', { workspace_id: 'smoke', path: '.' });
  await call(port, sessionId, 'stat_path', { workspace_id: 'smoke', path: 'README.md' });
  await call(port, sessionId, 'tree', { workspace_id: 'smoke', path: '.', max_entries: 20 });
  await call(port, sessionId, 'write_file', { workspace_id: 'smoke', path: 'note.txt', content: 'alpha beta', overwrite: true });
  await call(port, sessionId, 'edit_file', { workspace_id: 'smoke', path: 'note.txt', old_text: 'beta', new_text: 'BETA' });
  await expectText(port, sessionId, 'read_file', { workspace_id: 'smoke', path: 'note.txt' }, 'alpha BETA');
  await call(port, sessionId, 'write_binary_file', { workspace_id: 'smoke', path: 'artifact.png', base64: 'iVBORw==', overwrite: true });
  await expectText(port, sessionId, 'read_binary_file', { workspace_id: 'smoke', path: 'artifact.png' }, 'image/png');
}

async function exerciseContext(port, sessionId) {
  await expectText(port, sessionId, 'get_agent_bootstrap', { workspace_id: 'smoke' }, 'agent_start_here');
  await expectText(port, sessionId, 'get_agent_bootstrap', { workspace_id: 'smoke' }, 'provider_thread_prompt');
  await expectText(port, sessionId, 'get_agent_bootstrap', { workspace_id: 'smoke' }, 'OpenClaw-style workspace agent');
  await call(port, sessionId, 'record_progress', { workspace_id: 'smoke', title: 'Smoke progress', body: 'progress smoke' });
  await call(port, sessionId, 'record_decision', { workspace_id: 'smoke', title: 'Smoke decision', body: 'decision smoke' });
  await call(port, sessionId, 'update_current_task', { workspace_id: 'smoke', title: 'Smoke task', body: 'task smoke' });
  await call(port, sessionId, 'checkpoint_thread', { workspace_id: 'smoke', title: 'Smoke checkpoint', summary: 'checkpoint smoke', next_steps: ['ship it'] });
  await expectText(port, sessionId, 'get_context_snapshot', { workspace_id: 'smoke' }, 'checkpoint smoke');
}

async function exerciseSkills(port, sessionId) {
  await expectText(port, sessionId, 'list_skills', { workspace_id: 'smoke' }, 'smoke-skill');
  await expectText(port, sessionId, 'read_skill', { workspace_id: 'smoke', name: 'smoke-skill' }, 'Use smoke skills');
}

async function exerciseCommand(port, sessionId) {
  await call(port, sessionId, 'create_local_approval', { workspace_id: 'smoke', action: 'run_command' });
  await expectText(port, sessionId, 'run_command', { workspace_id: 'smoke', command: 'printf command-ok' }, 'command-ok');
}

async function exerciseProcess(port, sessionId) {
  await call(port, sessionId, 'create_local_approval', { workspace_id: 'smoke', action: 'start_process' });
  const started = await call(port, sessionId, 'start_process', { workspace_id: 'smoke', command: 'cat' });
  const processId = JSON.parse(started.result.content[0].text).data.process_id;
  await call(port, sessionId, 'write_process', { process_id: processId, input: 'process-ok', close_stdin: true });
  await delay(250);
  await expectText(port, sessionId, 'read_process', { process_id: processId }, 'process-ok');
}

async function expectText(port, sessionId, name, args, expected) {
  const result = await call(port, sessionId, name, args);
  const text = JSON.stringify(result);
  if (!text.includes(expected)) throw new Error(`${name} missing ${expected}: ${text}`);
}

async function writeConfig(file, workspaceRoot, port) {
  await writeFile(file, `server:\n  host: 127.0.0.1\n  port: ${port}\nworkspaces:\n  - id: smoke\n    name: Smoke\n    root: ${JSON.stringify(workspaceRoot)}\n    allow_read: true\n    allow_write: true\n    allow_patch: true\n    allow_tests: true\nsecurity:\n  max_file_bytes: 200000\n  max_response_bytes: 50000\n  max_search_results: 10\n  max_exec_ms: 10000\n  denied_globs: []\n`);
}

async function initialize(port) {
  const result = await rpc(port, 1, 'initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'primitive-smoke', version: '0.0.0' } });
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

function nextId() {
  nextId.value = (nextId.value ?? 1) + 1;
  return nextId.value;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
