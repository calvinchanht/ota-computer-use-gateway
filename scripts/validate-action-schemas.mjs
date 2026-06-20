#!/usr/bin/env node
import { readFile } from 'node:fs/promises';

const AGENTS = [
  {
    agentId: 'genesis',
    displayName: 'Webchat Genesis',
    serverUrl: 'https://genesis-api.unrealize.com',
    title: 'Webchat Genesis OTA + Threaddex API Action'
  },
  { agentId: 'mickey', displayName: 'Mickey', serverUrl: 'https://mickey-api.unrealize.com' },
  { agentId: 'hkerbot', displayName: 'HKerBot', serverUrl: 'https://hkerbot-api.unrealize.com' },
  { agentId: 'boba', displayName: 'Boba', serverUrl: 'https://boba-api.unrealize.com' },
  { agentId: 'catalyst', displayName: 'Catalyst', serverUrl: 'https://catalyst-api.unrealize.com' },
  { agentId: 'anna', displayName: 'Anna', serverUrl: 'https://anna-api.unrealize.com' }
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

  const expectedTitle = agent.title ?? `${agent.displayName} OTA + Threaddex API Action`;
  if (!text.includes(`title: ${expectedTitle}`)) fail('missing expected title');
  if (!text.includes(`url: ${agent.serverUrl}`)) fail('missing expected server URL');
  if (!text.includes(`/ota/api/v1/tool:`)) fail('missing /ota tool path');
  if (!text.includes(`/threaddex/v1/job/{job_id}:`)) fail('missing /threaddex job path');
  if (!text.includes(`operationId: requestJobContinuation`)) fail('missing continuation operation');
  if (!text.includes(`required: [checkpoint]`)) fail('continuation body must require checkpoint');
  if (!text.includes(`max_continuations:`)) fail('continuation body must expose max_continuations');
  if (/properties:\s*\{\}\s*\n\s*additionalProperties:\s*true\s*\n\s*required:/m.test(text)) {
    fail('request body schema has duplicate/empty properties before required fields');
  }
  if (text.includes(`/ota/api/v1/executor-jobs`) || text.includes(`/ota/api/v1/executors/`)) {
    fail('brokered executor Action paths must be absent unless an agent explicitly opts in');
  }
  if (!hasWorkspaceEnum(text, agent.agentId)) fail('missing expected workspace enum');

  for (const other of AGENTS) {
    if (other.agentId !== agent.agentId && hasWorkspaceEnum(text, other.agentId)) {
      fail(`contains stale workspace enum for ${other.agentId}`);
    }
  }

  return failures;
}

function hasWorkspaceEnum(text, agentId) {
  return text.includes(`enum: [${agentId}]`) ||
    new RegExp(`workspace_id:[\\s\\S]{0,160}enum:\\s*\\n\\s*- ${agentId}\\b`, 'm').test(text);
}
