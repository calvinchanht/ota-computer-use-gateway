import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = await mkdtemp(path.join(tmpdir(), 'gtp-smoke-'));
await writeFile(path.join(root, 'README.md'), '# Smoke\nhello mcp\n');
const config = path.join(root, 'config.yaml');
await writeFile(config, `workspaces:\n  - id: smoke\n    name: Smoke\n    root: ${JSON.stringify(root)}\n    allow_read: true\n    allow_patch: true\nsecurity:\n  max_file_bytes: 200000\n  max_response_bytes: 50000\n  max_search_results: 10\n  denied_globs: []\n`);

const child = spawn('node', ['dist/index.js', '--config', config], { stdio: ['pipe', 'pipe', 'inherit'] });
const responses = [];
child.stdout.on('data', (data) => responses.push(...data.toString().split('\n').filter(Boolean)));

send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'smoke', version: '0.0.0' } } });
await delay(300);
send({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} });
send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'read_file', arguments: { workspace_id: 'smoke', path: 'README.md' } } });
await delay(800);
child.kill('SIGTERM');

const text = responses.join('\n');
if (!text.includes('read_file') || !text.includes('hello mcp')) throw new Error(`smoke failed:\n${text}`);
console.log('smoke ok');

function send(message) {
  child.stdin.write(`${JSON.stringify(message)}\n`);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
