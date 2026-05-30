import { describe, expect, it } from 'vitest';
import type { Workspace } from '../src/core/workspaces.js';
import { browserStatus, listBrowserProfiles } from '../src/tools/browser.js';

describe('browser profile tools', () => {
  it('defaults browser profile label to workspace id', async () => {
    const result = await listBrowserProfiles(fixtureWorkspace());
    const data = result.data as any;
    expect(data.reminder).toBe('Close unused tabs.');
    expect(data.profiles[0].label).toBe('mickey');
    expect(data.profiles[0].headed).toBe(true);
  });

  it('lists configured Chrome/CDP profile metadata', async () => {
    const workspace = fixtureWorkspace({
      browser: { profiles: [{ label: 'genesis', user_data_dir: '/tmp/profile', cdp_port: 9333, display: ':20', headed: true, default: true, launch: false, cdp_host: '127.0.0.1' }] }
    });

    const data = (await listBrowserProfiles(workspace)).data as any;
    expect(data.profiles[0].label).toBe('genesis');
    expect(data.profiles[0].cdp_port).toBe(9333);
    expect(data.profiles[0].display).toBe(':20');
  });

  it('returns selected browser status with CDP endpoint', async () => {
    const workspace = fixtureWorkspace({
      browser: { profiles: [{ label: 'work', cdp_host: '127.0.0.1', cdp_port: 9444, headed: true, default: true, launch: false }] }
    });

    const data = (await browserStatus(workspace, 'work')).data as any;
    expect(data.profile.label).toBe('work');
    expect(data.cdp.endpoint).toBe('http://127.0.0.1:9444');
  });

  it('rejects unknown profile labels', async () => {
    await expect(browserStatus(fixtureWorkspace(), 'missing')).rejects.toThrow('unknown browser profile');
  });
});

function fixtureWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: 'mickey',
    name: 'Mickey',
    root: '/tmp',
    realRoot: '/tmp',
    allow_read: true,
    allow_write: true,
    allow_patch: true,
    allow_tests: true,
    allow_screen: true,
    allow_mouse_keyboard: false,
    browser: { profiles: [] },
    commands: {},
    ...overrides
  };
}
