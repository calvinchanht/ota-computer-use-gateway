import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Workspace } from '../src/core/workspaces.js';
import { browserStatus, listBrowserProfiles, listBrowserTabs, openBrowserTab } from '../src/tools/browser.js';

describe('browser profile tools', () => {
  afterEach(() => vi.restoreAllMocks());

  it('defaults browser profile label to workspace id', async () => {
    const result = await listBrowserProfiles(fixtureWorkspace());
    const data = result.data as any;
    expect(data.reminder).toBe('Close unused tabs.');
    expect(data.profiles[0].label).toBe('mickey');
    expect(data.profiles[0].headed).toBe(true);
  });

  it('lists configured Chrome/CDP profile metadata', async () => {
    const workspace = fixtureWorkspace({ browser: { profiles: [{ label: 'genesis', user_data_dir: '/tmp/profile', cdp_port: 9333, display: ':20', headed: true, default: true, launch: false, cdp_host: '127.0.0.1' }] } });
    const data = (await listBrowserProfiles(workspace)).data as any;
    expect(data.profiles[0].label).toBe('genesis');
    expect(data.profiles[0].cdp_port).toBe(9333);
    expect(data.profiles[0].display).toBe(':20');
  });

  it('returns selected browser status with CDP endpoint', async () => {
    mockFetch({ Browser: 'Chrome' });
    const workspace = fixtureWorkspace({ browser: { profiles: [{ label: 'work', cdp_host: '127.0.0.1', cdp_port: 9444, headed: true, default: true, launch: false }] } });
    const data = (await browserStatus(workspace, 'work')).data as any;
    expect(data.profile.label).toBe('work');
    expect(data.cdp.endpoint).toBe('http://127.0.0.1:9444');
    expect(data.cdp.reachable).toBe(true);
  });

  it('lists page targets from Chrome CDP', async () => {
    mockFetch([{ id: '1', type: 'page', title: 'Home', url: 'https://example.com', attached: true }, { id: '2', type: 'service_worker' }]);
    const data = (await listBrowserTabs(fixtureWorkspace())).data as any;
    expect(data.tabs).toEqual([{ id: '1', type: 'page', title: 'Home', url: 'https://example.com', attached: true }]);
  });

  it('opens a new tab through CDP with observe_after tabs', async () => {
    mockFetchSequence([{ id: 'new', type: 'page', title: 'New', url: 'https://example.com' }, [{ id: 'new', type: 'page', title: 'New', url: 'https://example.com' }]]);
    const data = (await openBrowserTab(fixtureWorkspace({ allow_mouse_keyboard: true }), 'https://example.com', undefined, { tabs: true })).data as any;
    expect(data.opened.id).toBe('new');
    expect(data.observation.tabs[0].url).toBe('https://example.com');
  });

  it('requires browser control for opening tabs', async () => {
    await expect(openBrowserTab(fixtureWorkspace(), 'https://example.com')).rejects.toThrow('browser control is not enabled');
  });

  it('rejects unknown profile labels', async () => {
    await expect(browserStatus(fixtureWorkspace(), 'missing')).rejects.toThrow('unknown browser profile');
  });
});

function mockFetch(body: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => body })));
}

function mockFetchSequence(bodies: unknown[]) {
  const responses = [...bodies];
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => responses.shift() })));
}

function fixtureWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: 'mickey', name: 'Mickey', root: '/tmp', realRoot: '/tmp',
    allow_read: true, allow_write: true, allow_patch: true, allow_tests: true,
    allow_screen: true, allow_mouse_keyboard: false,
    browser: { profiles: [] }, commands: {}, ...overrides
  };
}
