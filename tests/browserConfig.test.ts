import { describe, expect, it } from 'vitest';
import { configSchema } from '../src/config/schema.js';

function parseBrowser(profiles: Array<Record<string, unknown>>) {
  return configSchema.safeParse({
    workspaces: [{
      id: 'genesis', name: 'Genesis', root: process.cwd(),
      browser: { max_open_work_pages: 5, profiles }
    }]
  });
}

describe('browser role separation config', () => {
  it('accepts distinct work and Threaddex browser processes', () => {
    const parsed = parseBrowser([
      { label: 'GenesisTeam', purpose: 'threaddex', user_data_dir: '/profiles/GenesisTeam', cdp_host: '127.0.0.1', cdp_port: 33409 },
      { label: 'GenesisWork', purpose: 'work', user_data_dir: '/profiles/GenesisWork', cdp_host: '127.0.0.1', cdp_port: 33411, default: true }
    ]);
    expect(parsed.success).toBe(true);
  });

  it('rejects work and Threaddex profiles sharing one CDP endpoint', () => {
    const parsed = parseBrowser([
      { label: 'Team', purpose: 'threaddex', cdp_host: '127.0.0.1', cdp_port: 33409 },
      { label: 'Work', purpose: 'work', cdp_host: '127.0.0.1', cdp_port: 33409 }
    ]);
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.some((issue) => issue.message.includes('different CDP endpoints'))).toBe(true);
  });

  it('rejects work and Threaddex profiles sharing one user data directory', () => {
    const parsed = parseBrowser([
      { label: 'Team', purpose: 'threaddex', user_data_dir: '/profiles/shared', cdp_port: 33409 },
      { label: 'Work', purpose: 'work', user_data_dir: '/profiles/shared', cdp_port: 33411 }
    ]);
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.some((issue) => issue.message.includes('different user_data_dir'))).toBe(true);
  });
});
