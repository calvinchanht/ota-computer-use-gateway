import { z } from 'zod';
import { asText, fail } from '../../core/result.js';
import {
  genesisAgentDeepDive,
  genesisBootstrap,
  genesisEstateOverview,
  genesisHostDeepDive,
  genesisSafeDiagnostic
} from '../../tools/genesis.js';
import { READ_ONLY, TOOL_RESULT_OUTPUT_SCHEMA } from './annotations.js';
import type { RegisterContext } from './types.js';

export function registerGenesisTools({ server }: RegisterContext): void {
  server.registerTool('estate_bootstrap', {
    title: 'Estate bootstrap',
    description: 'Read-only estate-control bootstrap with cross-agent and cross-host orientation.',
    inputSchema: {}, outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: READ_ONLY
  }, async () => safe(genesisBootstrap()));

  server.registerTool('estate_overview', {
    title: 'Estate overview',
    description: 'Read-only bounded overview of the control-plane estate from continuity docs.',
    inputSchema: {}, outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: READ_ONLY
  }, async () => safe(genesisEstateOverview()));

  server.registerTool('estate_agent_deep_dive', {
    title: 'Estate agent deep dive',
    description: 'Read one canonical estate agent card by agent id/name.',
    inputSchema: { agent: z.string() }, outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: READ_ONLY
  }, async ({ agent }) => safe(genesisAgentDeepDive(agent)));

  server.registerTool('estate_host_deep_dive', {
    title: 'Estate host deep dive',
    description: 'Read one canonical estate host/machine profile by host id/name.',
    inputSchema: { host: z.string() }, outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: READ_ONLY
  }, async ({ host }) => safe(genesisHostDeepDive(host)));

  server.registerTool('estate_safe_diagnostic', {
    title: 'Estate safe diagnostic',
    description: 'Read-only safe diagnostic summary for estate, agent, or host scope; no live commands or mutations.',
    inputSchema: { scope: z.enum(['estate', 'agent', 'host']).default('estate'), target: z.string().optional() },
    outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: READ_ONLY
  }, async ({ scope, target }) => safe(genesisSafeDiagnostic(scope, target)));
}

async function safe(promise: Promise<ReturnType<typeof fail> | Awaited<ReturnType<typeof genesisBootstrap>>>) {
  try { return asText(await promise); }
  catch (error) { return asText(fail(error instanceof Error ? error.message : String(error))); }
}
