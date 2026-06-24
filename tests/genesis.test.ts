import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { genesisAgentDeepDive, genesisBootstrap, genesisEstateOverview, genesisHostDeepDive, genesisSafeDiagnostic } from '../src/tools/genesis.js';

process.env.OTA_GENESIS_CONTINUITY_ROOT ??= path.resolve('..', 'infunity-agents', 'genesis', 'continuity');

describe('estate report tools', () => {
  it('returns a bounded bootstrap without secrets', async () => {
    const result = await genesisBootstrap();
    expect(result.ok).toBe(true);
    const text = JSON.stringify(result);
    expect(text).toContain('estate control plane');
    expect(text).not.toMatch(/Authorization: Bearer\s+[A-Za-z0-9._-]+/);
  });

  it('returns estate overview card lists', async () => {
    const result = await genesisEstateOverview();
    expect(result.ok).toBe(true);
    const data = result.data as any;
    expect(Array.isArray(data.agents)).toBe(true);
    expect(Array.isArray(data.hosts)).toBe(true);
  });

  it('reads known agent and host cards', async () => {
    const agent = await genesisAgentDeepDive('paperlead-ops-v1');
    expect(agent.ok).toBe(true);
    expect(JSON.stringify(agent.data)).toContain('PaperLead');
    const host = await genesisHostDeepDive('personal-vps-current');
    expect(host.ok).toBe(true);
    expect(JSON.stringify(host.data)).toContain('personal');
  });

  it('rejects unsafe names and supports estate diagnostic', async () => {
    await expect(genesisAgentDeepDive('../secret')).rejects.toThrow('invalid agent name');
    const diag = await genesisSafeDiagnostic('estate');
    expect(diag.ok).toBe(true);
  });
});
