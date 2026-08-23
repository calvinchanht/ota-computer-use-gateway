#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import YAML from 'yaml';
import { API_SET_NAMES, configSchema } from '../dist/config/schema.js';
import { allowedTools } from '../dist/tools/policy.js';

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const configPath = required(args.config, '--config');
  const workspaceId = required(args['workspace-id'] ?? args.workspace, '--workspace-id');
  const source = await readFile(configPath, 'utf8');
  const raw = YAML.parse(source);
  enableApiSets(raw, workspaceId, setList(args['enable-api-sets']));
  const workspace = parsedWorkspace(raw, workspaceId);
  raw.server = raw.server ?? {};
  const hostPlatform = normalizeHostPlatform(args['host-platform']);
  raw.server.exposed_tools = allowedTools(workspace, hostPlatform).sort();
  await writeFile(configPath, YAML.stringify(raw));
  printSummary(configPath, workspaceId, hostPlatform, raw.server.exposed_tools);
}


function normalizeHostPlatform(value) {
  if (!value) return undefined;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'mac' || normalized === 'darwin') return 'macos';
  if (normalized === 'win32') return 'windows';
  if (['linux', 'macos', 'windows'].includes(normalized)) return normalized;
  throw new Error(`unsupported --host-platform: ${value}`);
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) {
      out._.push(argv[i]);
      continue;
    }
    out[argv[i].replace(/^--/, '')] = argv[i + 1];
    i += 1;
  }
  if (!out.config && out._.length) out.config = out._[0];
  if (!out['workspace-id'] && !out.workspace && out._.length > 1) out['workspace-id'] = out._[1];
  if (!out['enable-api-sets'] && out._.length > 2) out['enable-api-sets'] = out._.slice(2).join(',');
  return out;
}

function required(value, name) {
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function setList(value) {
  return new Set((value ?? '').split(',').map((item) => item.trim()).filter(Boolean));
}

function enableApiSets(raw, workspaceId, sets) {
  if (!sets.size) return;
  const workspace = rawWorkspace(raw, workspaceId);
  workspace.api_sets = workspace.api_sets ?? {};
  for (const set of sets) {
    if (!API_SET_NAMES.includes(set)) throw new Error(`unsupported --enable-api-sets value: ${set}`);
    workspace.api_sets[set] = true;
  }
}

function rawWorkspace(raw, workspaceId) {
  const workspace = raw.workspaces?.find((item) => item?.id === workspaceId);
  if (!workspace) throw new Error(`workspace not found: ${workspaceId}`);
  return workspace;
}

function parsedWorkspace(raw, workspaceId) {
  const parsed = configSchema.parse(raw);
  const workspace = parsed.workspaces.find((item) => item.id === workspaceId);
  if (!workspace) throw new Error(`workspace not found after parse: ${workspaceId}`);
  return workspace;
}

function printSummary(configPath, workspaceId, hostPlatform, tools) {
  console.log(JSON.stringify({
    ok: true,
    config: configPath,
    workspace_id: workspaceId,
    host_platform: hostPlatform ?? process.platform,
    exposed_tool_count: tools.length,
    exposed_tools: tools
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
