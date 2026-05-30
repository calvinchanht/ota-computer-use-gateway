import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Workspace } from '../src/core/workspaces.js';
import { activateBrowserTab, browserCdpBatch, browserCdpCall, browserStatus, browserTabInfo, browserTabScreenshot, browserTabSnapshot, clickBrowserTab, closeBrowserTab, listBrowserProfiles, listBrowserTabs, navigateBrowserTab, openBrowserTab, typeBrowserTab } from '../src/tools/browser.js';

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
    expect(data.tabs).toEqual([{ id: '1', key: null, type: 'page', title: 'Home', url: 'https://example.com', attached: true }]);
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

  it('captures a bounded DOM snapshot from one tab through CDP websocket', async () => {
    mockFetch([{ id: '1', type: 'page', title: 'Home', url: 'https://example.com', webSocketDebuggerUrl: 'ws://cdp/1' }]);
    mockWebSocket({ documents: [{ nodes: {} }], strings: ['hello'] });
    const data = (await browserTabSnapshot(fixtureWorkspace(), '1')).data as any;
    expect(data.snapshot.truncated).toBe(false);
    expect(data.snapshot.json).toContain('hello');
  });

  it('requires screen permission for browser screenshots and snapshots', async () => {
    await expect(browserTabScreenshot(fixtureWorkspace({ allow_screen: false }), '1')).rejects.toThrow('screen observation is not enabled');
    await expect(browserTabSnapshot(fixtureWorkspace({ allow_screen: false }), '1')).rejects.toThrow('screen observation is not enabled');
  });

  it('opens a new tab through CDP with observe_after tabs', async () => {
    mockFetchSequence([{ id: 'new', type: 'page', title: 'New', url: 'https://example.com' }, [{ id: 'new', type: 'page', title: 'New', url: 'https://example.com' }]]);
    const data = (await openBrowserTab(controlWorkspace(), 'https://example.com', undefined, { tabs: true })).data as any;
    expect(data.opened.id).toBe('new');
    expect(data.observation.tabs[0].url).toBe('https://example.com');
  });

  it('assigns stable tab keys and resolves them as target ids', async () => {
    const workspace = controlWorkspace({ root: '/tmp/stable-tabs', realRoot: '/tmp/stable-tabs' });
    mockFetchSequence([
      { id: 'new', type: 'page', title: 'New', url: 'https://example.com' },
      [{ id: 'new', type: 'page', title: 'New', url: 'https://example.com', webSocketDebuggerUrl: 'ws://cdp/new' }],
      [{ id: 'new', type: 'page', title: 'Jobs', url: 'https://example.com/jobs', webSocketDebuggerUrl: 'ws://cdp/new' }]
    ]);
    const opened = (await openBrowserTab(workspace, 'https://example.com', undefined, undefined, 'job-search-main')).data as any;
    mockWebSocket({ frameId: 'frame-1' });
    const nav = (await navigateBrowserTab(workspace, 'job-search-main', 'https://example.com/jobs')).data as any;
    expect(opened.opened.key).toBe('job-search-main');
    expect(nav.target_id).toBe('new');
    expect(nav.target_ref).toBe('job-search-main');
  });

  it('navigates an existing tab through CDP websocket', async () => {
    mockFetchSequence([
      [{ id: '1', type: 'page', webSocketDebuggerUrl: 'ws://cdp/1' }],
      [{ id: '1', type: 'page', title: 'Next', url: 'https://example.com/next' }]
    ]);
    mockWebSocket({ frameId: 'frame-1', loaderId: 'loader-1' });
    const data = (await navigateBrowserTab(controlWorkspace(), '1', 'https://example.com/next', undefined, { tabs: true })).data as any;
    expect(data.navigation.frameId).toBe('frame-1');
    expect(data.observation.tabs[0].url).toBe('https://example.com/next');
  });

  it('clicks viewport coordinates through CDP websocket', async () => {
    mockFetchSequence([
      [{ id: '1', type: 'page', webSocketDebuggerUrl: 'ws://cdp/1' }],
      [{ id: '1', type: 'page', title: 'Clicked', url: 'https://example.com' }]
    ]);
    const sends = mockWebSocket({});
    const data = (await clickBrowserTab(controlWorkspace(), '1', 12.9, 34.2, undefined, { tabs: true })).data as any;
    expect(data.click).toEqual({ x: 12, y: 34 });
    expect(data.observation.tabs[0].title).toBe('Clicked');
    expect(sends[0]).toContain('mousePressed');
    expect(sends[1]).toContain('mouseReleased');
  });

  it('types text through CDP websocket', async () => {
    mockFetchSequence([
      [{ id: '1', type: 'page', webSocketDebuggerUrl: 'ws://cdp/1' }],
      [{ id: '1', type: 'page', title: 'Typed', url: 'https://example.com' }]
    ]);
    const sends = mockWebSocket({});
    const data = (await typeBrowserTab(controlWorkspace(), '1', 'hello', undefined, { tabs: true })).data as any;
    expect(data.text_chars).toBe(5);
    expect(data.observation.tabs[0].title).toBe('Typed');
    expect(sends[0]).toContain('Input.insertText');
    expect(sends[0]).toContain('hello');
  });

  it('proxies a generic CDP call through the scoped target websocket', async () => {
    mockFetch([{ id: '1', type: 'page', webSocketDebuggerUrl: 'ws://cdp/1' }]);
    const sends = mockWebSocket({ value: 42 });
    const data = (await browserCdpCall(controlWorkspace(), '1', 'Runtime.evaluate', { expression: '6 * 7' })).data as any;
    expect(data.method).toBe('Runtime.evaluate');
    expect(data.result.json).toContain('42');
    expect(sends[0]).toContain('Runtime.evaluate');
  });

  it('proxies a bounded batch of CDP calls through the scoped target websocket', async () => {
    mockFetch([{ id: '1', type: 'page', webSocketDebuggerUrl: 'ws://cdp/1' }]);
    const sends = mockWebSocket({ ok: true });
    const data = (await browserCdpBatch(controlWorkspace(), '1', [{ method: 'Page.enable' }, { method: 'Runtime.enable' }])).data as any;
    expect(data.results).toHaveLength(2);
    expect(sends[0]).toContain('Page.enable');
    expect(sends[1]).toContain('Runtime.enable');
  });

  it('activates and closes tabs through CDP', async () => {
    mockFetchSequence([[{ id: '1', type: 'page' }], 'Target activated', [{ id: '1', type: 'page' }], [{ id: '1', type: 'page' }], 'Target is closing']);
    const active = (await activateBrowserTab(controlWorkspace(), '1', undefined, { tabs: true })).data as any;
    const closed = (await closeBrowserTab(controlWorkspace(), '1')).data as any;
    expect(active.target_id).toBe('1');
    expect(active.observation.tabs[0].id).toBe('1');
    expect(closed.target_id).toBe('1');
  });

  it('requires browser control for tab mutations', async () => {
    await expect(openBrowserTab(fixtureWorkspace(), 'https://example.com')).rejects.toThrow('browser control is not enabled');
    await expect(navigateBrowserTab(fixtureWorkspace(), '1', 'https://example.com')).rejects.toThrow('browser control is not enabled');
    await expect(clickBrowserTab(fixtureWorkspace(), '1', 1, 1)).rejects.toThrow('browser control is not enabled');
    await expect(typeBrowserTab(fixtureWorkspace(), '1', 'x')).rejects.toThrow('browser control is not enabled');
    await expect(browserCdpCall(fixtureWorkspace(), '1', 'Runtime.evaluate')).rejects.toThrow('browser control is not enabled');
    await expect(closeBrowserTab(fixtureWorkspace(), '1')).rejects.toThrow('browser control is not enabled');
  });

  it('rejects unknown profile labels', async () => {
    await expect(browserStatus(fixtureWorkspace(), 'missing')).rejects.toThrow('unknown browser profile');
  });
});

function controlWorkspace(overrides: Partial<Workspace> = {}) {
  return fixtureWorkspace({ allow_mouse_keyboard: true, ...overrides });
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
  const sends: string[] = [];
  class MockWebSocket extends EventTarget {
    close = vi.fn();
    constructor(public url: string) {
      super();
      setTimeout(() => this.dispatchEvent(new Event('open')), 0);
    }
    send = vi.fn((message: string) => {
      sends.push(message);
      const id = JSON.parse(message).id;
      const event = new MessageEvent('message', { data: JSON.stringify({ id, result }) });
      setTimeout(() => this.dispatchEvent(event), 0);
    });
  }
  vi.stubGlobal('WebSocket', MockWebSocket);
  return sends;
}

function fixtureWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: 'mickey', name: 'Mickey', root: '/tmp', realRoot: '/tmp',
    allow_read: true, allow_write: true, allow_patch: true, allow_tests: true,
    allow_screen: true, allow_mouse_keyboard: false,
    browser: { profiles: [] }, commands: {}, ...overrides
  };
}
