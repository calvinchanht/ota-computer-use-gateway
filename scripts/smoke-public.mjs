const url = requiredEnv('OTA_GATEWAY_SMOKE_URL');
const token = process.env.OTA_GATEWAY_SMOKE_TOKEN ?? '';
const workspaceId = process.env.OTA_GATEWAY_SMOKE_WORKSPACE ?? 'mickey';
const allowWrite = process.env.OTA_GATEWAY_SMOKE_WRITE === '1';

const sessionId = await initialize();
await expectText('get_tool_profile', {}, 'mcp_explicit', sessionId);
await expectText('workspace_status', {}, workspaceId, sessionId);
await call('list_dir', { workspace_id: workspaceId, path: '.' }, sessionId);
await call('get_workspace_policy', { workspace_id: workspaceId }, sessionId);

if (allowWrite) await writeSmoke(sessionId);
console.log(`public smoke ok (${allowWrite ? 'read/write' : 'read-only'})`);

async function writeSmoke(sessionId) {
  const stamp = new Date().toISOString();
  const path = '.agent/smoke/public-smoke.txt';
  await call('write_file', { workspace_id: workspaceId, path, content: `before ${stamp}\n`, overwrite: true }, sessionId);
  await call('edit_file', { workspace_id: workspaceId, path, old_text: 'before', new_text: 'after' }, sessionId);
  await expectText('read_file', { workspace_id: workspaceId, path }, `after ${stamp}`, sessionId);
  await call('create_local_approval', { workspace_id: workspaceId, action: 'run_command', approved_by: 'public-smoke' }, sessionId);
  await expectText('run_command', { workspace_id: workspaceId, command: 'printf public-command-smoke' }, 'public-command-smoke', sessionId);
}

async function initialize() {
  const result = await rpc(1, 'initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'public-smoke', version: '0.0.0' }
  });
  return result.sessionId;
}

async function expectText(name, args, expected, sessionId) {
  const result = await call(name, args, sessionId);
  const text = JSON.stringify(result);
  if (!text.includes(expected)) throw new Error(`${name} missing ${expected}: ${text}`);
}

async function call(name, args, sessionId) {
  return rpc(nextId(), 'tools/call', { name, arguments: args }, sessionId);
}

async function rpc(id, method, params, sessionId) {
  const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
  if (token) headers.authorization = `Bearer ${token}`;
  if (sessionId) headers['mcp-session-id'] = sessionId;
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id, method, params }) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status}: ${text}`);
  return { ...parseResponse(text), sessionId: res.headers.get('mcp-session-id') ?? sessionId };
}

function parseResponse(text) {
  const data = text.split('\n').find((line) => line.startsWith('data: '));
  return JSON.parse(data ? data.slice(6) : text);
}

function nextId() {
  nextId.value = (nextId.value ?? 1) + 1;
  return nextId.value;
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`missing required environment variable: ${name}`);
  return value;
}
