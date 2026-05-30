const url = requiredEnv('OTA_GATEWAY_SMOKE_URL');
const token = process.env.OTA_GATEWAY_SMOKE_TOKEN ?? '';
const workspaceId = process.env.OTA_GATEWAY_SMOKE_WORKSPACE ?? 'mickey';
const writeProof = process.env.OTA_GATEWAY_ACCEPTANCE_WRITE === '1';
const pickupSkill = process.env.OTA_GATEWAY_ACCEPTANCE_SKILL ?? `${workspaceId}-pickup`;
const acceptanceMarker = process.env.OTA_GATEWAY_ACCEPTANCE_MARKER ?? 'provider_acceptance';

const sessionId = await initialize();

await expectText('get_agent_bootstrap', { workspace_id: workspaceId }, acceptanceMarker, sessionId);
await expectText('get_agent_bootstrap', { workspace_id: workspaceId }, pickupSkill, sessionId);
await expectText('get_workspace_policy', { workspace_id: workspaceId }, workspaceId, sessionId);
await expectText('get_tool_profile', {}, 'mcp_explicit', sessionId);
await expectText('list_skills', { workspace_id: workspaceId }, pickupSkill, sessionId);
await expectText('read_skill', { workspace_id: workspaceId, name: pickupSkill }, 'OpenClaw-like provider chat-thread agent', sessionId);
await expectText('list_browser_profiles', { workspace_id: workspaceId }, 'Close unused tabs.', sessionId);
await expectText('browser_status', { workspace_id: workspaceId }, 'Close unused tabs.', sessionId);
await expectText('list_browser_tabs', { workspace_id: workspaceId }, 'Close unused tabs.', sessionId);

if (writeProof) await checkpointAcceptance(sessionId);

console.log(`${workspaceId} acceptance smoke ok (${writeProof ? 'with checkpoint' : 'read-only'})`);

async function checkpointAcceptance(sessionId) {
  const stamp = new Date().toISOString();
  await call('checkpoint_thread', {
    workspace_id: workspaceId,
    title: `${workspaceId} acceptance smoke`,
    summary: `${workspaceId} acceptance smoke passed at ${stamp}.`,
    next_steps: ['Continue Catalyst anchoring after Mickey proof is accepted.']
  }, sessionId);
  await expectText('get_agent_bootstrap', { workspace_id: workspaceId }, `${workspaceId} acceptance smoke passed at ${stamp}`, sessionId);
}

async function initialize() {
  const result = await rpc(1, 'initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'mickey-acceptance-smoke', version: '0.0.0' }
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
