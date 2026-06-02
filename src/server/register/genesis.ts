import { z } from 'zod';
import { asText, fail } from '../../core/result.js';
import { genesisAgentDeepDive, genesisBootstrap, genesisEstateOverview, genesisHostDeepDive, genesisSafeDiagnostic } from '../../tools/genesis.js';
import { READ_ONLY, TOOL_RESULT_OUTPUT_SCHEMA } from './annotations.js';
import type { RegisterContext } from './types.js';

export function registerGenesisTools({ server }: RegisterContext): void {
  server.registerTool('genesis_bootstrap', {
    title: 'Genesis bootstrap',
    description: 'Read-only Webchat Genesis bootstrap with control-plane orientation and safety boundaries.',
    inputSchema: {}, outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: READ_ONLY
  }, async () => safe(genesisBootstrap()));

  server.registerTool('genesis_estate_overview', {
    title: 'Genesis estate overview',
    description: 'Read-only bounded overview of the Genesis control-plane estate from continuity docs.',
    inputSchema: {}, outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: READ_ONLY
  }, async () => safe(genesisEstateOverview()));

  server.registerTool('genesis_agent_deep_dive', {
    title: 'Genesis agent deep dive',
    description: 'Read one canonical Genesis agent card by agent id/name.',
    inputSchema: { agent: z.string() }, outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: READ_ONLY
  }, async ({ agent }) => safe(genesisAgentDeepDive(agent)));

  server.registerTool('genesis_host_deep_dive', {
    title: 'Genesis host deep dive',
    description: 'Read one canonical Genesis host/machine profile by host id/name.',
    inputSchema: { host: z.string() }, outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: READ_ONLY
  }, async ({ host }) => safe(genesisHostDeepDive(host)));

  server.registerTool('genesis_safe_diagnostic', {
    title: 'Genesis safe diagnostic',
    description: 'Read-only safe diagnostic summary for estate, agent, or host scope; no live commands or mutations.',
    inputSchema: { scope: z.enum(['estate', 'agent', 'host']).default('estate'), target: z.string().optional() },
    outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: READ_ONLY
  }, async ({ scope, target }) => safe(genesisSafeDiagnostic(scope, target)));
}

async function safe(promise: Promise<ReturnType<typeof fail> | Awaited<ReturnType<typeof genesisBootstrap>>>) {
  try { return asText(await promise); }
  catch (error) { return asText(fail(error instanceof Error ? error.message : String(error))); }
}
