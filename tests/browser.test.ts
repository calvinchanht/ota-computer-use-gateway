import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Workspace } from '../src/core/workspaces.js';
import { activateBrowserTab, browserStatus, browserTabInfo, browserTabScreenshot, closeBrowserTab, listBrowserProfiles, listBrowserTabs, openBrowserTab } from '../src/tools/browser.js';

describe('browser profile tools', () => {
  afterEach(() => vi.restoreAllMocks());

  it('defaults browser profile label to workspace id', async () => {
    const data = (await listBrowserProfiles(fixtureWorkspace())).data as any;
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

  it('returns metadata for one tab by id', async () => {
    mockFetch([{ id: '1', type: 'page', title: 'Home', url: 'https://example.com', attached: true }]);
    const data = (await browserTabInfo(fixtureWorkspace(), '1')).data as any;
    expect(data.tab.url).toBe('https://example.com');
  });

  it('captures a screenshot from one tab through CDP websocket', async () => {
    mockFetch([{ id: '1', type: 'page', title: 'Home', url: 'https://example.com', webSocketDebuggerUrl: 'ws://cdp/1' }]);
    mockWebSocket({ data: Buffer.from('png').toString('base64') });
    const data = (await browserTabScreenshot(fixtureWorkspace(), '1')).data as any;
    expect(data.screenshot.media_type).toBe('image/png');
    expect(data.screenshot.bytes).toBe(3);
    expect(data.tab.id).toBe('1');
  });

  it('requires screen permission for browser screenshots', async () => {
    await expect(browserTabScreenshot(fixtureWorkspace({ allow_screen: false }), '1')).rejects.toThrow('screen observation is not enabled');
  });

  it('opens a new tab through CDP with observe_after tabs', async () => {
    mockFetchSequence([{ id: 'new', type: 'page', title: 'New', url: 'https://example.com' }, [{ id: 'new', type: 'page', title: 'New', url: 'https://example.com' }]]);
    const data = (await openBrowserTab(controlWorkspace(), 'https://example.com', undefined, { tabs: true })).data as any;
    expect(data.opened.id).toBe('new');
    expect(data.observation.tabs[0].url).toBe('https://example.com');
  });

  it('activates and closes tabs through CDP', async () => {
    mockFetchSequence(['Target activated', [{ id: '1', type: 'page' }], 'Target is closing']);
    const active = (await activateBrowserTab(controlWorkspace(), '1', undefined, { tabs: true })).data as any;
    const closed = (await closeBrowserTab(controlWorkspace(), '1')).data as any;
    expect(active.target_id).toBe('1');
    expect(active.observation.tabs[0].id).toBe('1');
    expect(closed.target_id).toBe('1');
  });

  it('requires browser control for tab mutations', async () => {
    await expect(openBrowserTab(fixtureWorkspace(), 'https://example.com')).rejects.toThrow('browser control is not enabled');
    await expect(closeBrowserTab(fixtureWorkspace(), '1')).rejects.toThrow('browser control is not enabled');
  });

  it('rejects unknown profile labels', async () => {
    await expect(browserStatus(fixtureWorkspace(), 'missing')).rejects.toThrow('unknown browser profile');
  });
});

function controlWorkspace() {
  return fixtureWorkspace({ allow_mouse_keyboard: true });
}

function mockFetch(body: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => response(body)));
}

function mockFetchSequence(bodies: unknown[]) {
  const responses = [...bodies];
  vi.stubGlobal('fetch', vi.fn(async () => response(responses.shift())));
}

function response(body: unknown) {
  return { ok: true, json: async () => body, text: async () => String(body) };
}

function mockWebSocket(result: unknown) {
  class MockWebSocket extends EventTarget {
    close = vi.fn();
    constructor(public url: string) {
      super();
      setTimeout(() => this.dispatchEvent(new Event('open')), 0);
    }
    send = vi.fn(() => {
      const event = new MessageEvent('message', { data: JSON.stringify({ id: 1, result }) });
      setTimeout(() => this.dispatchEvent(event), 0);
    });
  }
  vi.stubGlobal('WebSocket', MockWebSocket);
}

function fixtureWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: 'mickey', name: 'Mickey', root: '/tmp', realRoot: '/tmp',
    allow_read: true, allow_write: true, allow_patch: true, allow_tests: true,
    allow_screen: true, allow_mouse_keyboard: false,
    browser: { profiles: [] }, commands: {}, ...overrides
  };
}
