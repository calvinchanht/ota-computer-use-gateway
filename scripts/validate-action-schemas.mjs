#!/usr/bin/env node
import { readFile } from 'node:fs/promises';

const AGENTS = [
  { agentId: 'mickey', displayName: 'Mickey', serverUrl: 'https://mickey-api.unrealize.com' },
  { agentId: 'hkerbot', displayName: 'HKerBot', serverUrl: 'https://hkerbot-api.unrealize.com' },
  { agentId: 'boba', displayName: 'Boba', serverUrl: 'https://boba-api.unrealize.com' },
  { agentId: 'catalyst', displayName: 'Catalyst', serverUrl: 'https://catalyst-api.unrealize.com' }
];

let failures = 0;
for (const agent of AGENTS) {
  const path = new URL(`../docs/examples/${agent.agentId}-api-action-openapi.yaml`, import.meta.url);
  const text = await readFile(path, 'utf8');
  failures += validateSchemaText(text, agent);
}

if (failures > 0) {
  process.exitCode = 1;
} else {
  console.log(`validated ${AGENTS.length} generated action schemas`);
}

function validateSchemaText(text, agent) {
  let failures = 0;
  const fail = (message) => {
    failures += 1;
    console.error(`${agent.agentId}: ${message}`);
  };

  if (!text.includes(`title: ${agent.displayName} OTA + Threaddex API Action`)) fail('missing expected title');
  if (!text.includes(`url: ${agent.serverUrl}`)) fail('missing expected server URL');
  if (!text.includes(`/ota/api/v1/tool:`)) fail('missing /ota tool path');
  if (!text.includes(`/threaddex/v1/job/{job_id}:`)) fail('missing /threaddex job path');
  if (!text.includes(`enum: [${agent.agentId}]`)) fail('missing expected workspace enum');

  for (const other of AGENTS) {
    if (other.agentId !== agent.agentId && text.includes(`enum: [${other.agentId}]`)) {
      fail(`contains stale workspace enum for ${other.agentId}`);
    }
  }

  return failures;
}
