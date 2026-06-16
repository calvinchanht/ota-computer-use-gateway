#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';

const AGENTS = [
  { agentId: 'mickey', displayName: 'Mickey', serverUrl: 'https://mickey-api.unrealize.com' },
  { agentId: 'hkerbot', displayName: 'HKerBot', serverUrl: 'https://hkerbot-api.unrealize.com' },
  { agentId: 'boba', displayName: 'Boba', serverUrl: 'https://boba-api.unrealize.com' },
  { agentId: 'catalyst', displayName: 'Catalyst', serverUrl: 'https://catalyst-api.unrealize.com' }
];

const templatePath = new URL('../docs/examples/action-openapi.template.yaml', import.meta.url);
const template = await readFile(templatePath, 'utf8');

const requestedAgent = parseAgentArg(process.argv.slice(2));
const agents = requestedAgent ? AGENTS.filter((agent) => agent.agentId === requestedAgent) : AGENTS;
if (requestedAgent && agents.length === 0) {
  throw new Error(`unknown agent: ${requestedAgent}. Known agents: ${AGENTS.map((agent) => agent.agentId).join(', ')}`);
}

for (const agent of agents) {
  const output = render(template, agent);
  validateRenderedSchema(output, agent);
  await writeFile(new URL(`../docs/examples/${agent.agentId}-api-action-openapi.yaml`, import.meta.url), output);
  console.log(`generated docs/examples/${agent.agentId}-api-action-openapi.yaml`);
}

function parseAgentArg(argv) {
  const index = argv.indexOf('--agent');
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (!value) throw new Error('--agent requires a value');
  return value;
}

function render(templateText, agent) {
  return templateText
    .replaceAll('{{agentId}}', agent.agentId)
    .replaceAll('{{displayName}}', agent.displayName)
    .replaceAll('{{serverUrl}}', agent.serverUrl);
}

function validateRenderedSchema(text, agent) {
  if (text.includes('{{')) throw new Error(`unrendered template token in ${agent.agentId} schema`);
  if (!text.includes(`url: ${agent.serverUrl}`)) throw new Error(`missing server URL for ${agent.agentId}`);
  if (!text.includes(`enum: [${agent.agentId}]`)) throw new Error(`missing workspace enum for ${agent.agentId}`);
  for (const other of AGENTS) {
    if (other.agentId !== agent.agentId && text.includes(`enum: [${other.agentId}]`)) {
      throw new Error(`${agent.agentId} schema contains stale workspace enum for ${other.agentId}`);
    }
  }
}
