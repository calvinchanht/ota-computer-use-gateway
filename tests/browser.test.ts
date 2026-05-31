import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Workspace } from '../src/core/workspaces.js';
import { browserCdpBatch, browserCdpBrowserBatch, browserCdpBrowserCall, browserCdpCall, browserStatus, listBrowserProfiles, listBrowserTabs } from '../src/tools/browser.js';

describe('browser CDP proxy tools', () => {
  afterEach(() => vi.restoreAllMocks());

  it('defaults browser profile label to workspace id', async () => {
    const data = (await listBrowserProfiles(fixtureWorkspace())).data as any;
    expect(data.reminder).toContain('CDP');
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

  it('lists Chrome debugging targets', async () => {
    mockFetch([{ id: '1', type: 'page', title: 'Home', url: 'https://example.com', attached: true, webSocketDebuggerUrl: 'ws://cdp/1' }, { id: '2', type: 'service_worker' }]);
    const data = (await listBrowserTabs(fixtureWorkspace())).data as any;
    expect(data.targets).toEqual([
      { id: '1', type: 'page', title: 'Home', url: 'https://example.com', attached: true, has_websocket: true },
      { id: '2', type: 'service_worker', title: '', url: '', attached: false, has_websocket: false }
    ]);
  });

  it('proxies a browser-level CDP call through the scoped browser websocket', async () => {
    mockFetch({ webSocketDebuggerUrl: 'ws://cdp/browser' });
    const sends = mockWebSocket({ product: 'Chrome/test' });
    const data = (await browserCdpBrowserCall(controlWorkspace(), 'Browser.getVersion')).data as any;
    expect(data.method).toBe('Browser.getVersion');
    expect(data.result.json).toContain('Chrome/test');
    expect(sends[0]).toContain('Browser.getVersion');
  });

  it('proxies browser-level CDP batches through the scoped browser websocket', async () => {
    mockFetch({ webSocketDebuggerUrl: 'ws://cdp/browser' });
    const sends = mockWebSocket({ ok: true });
    const data = (await browserCdpBrowserBatch(controlWorkspace(), [{ method: 'Target.getTargets' }])).data as any;
    expect(data.results).toHaveLength(1);
    expect(sends[0]).toContain('Target.getTargets');
  });

  it('proxies a page-target CDP call through the scoped target websocket', async () => {
    mockFetch([{ id: '1', type: 'page', webSocketDebuggerUrl: 'ws://cdp/1' }]);
    const sends = mockWebSocket({ value: 42 });
    const data = (await browserCdpCall(controlWorkspace(), '1', 'Runtime.evaluate', { expression: '6 * 7' })).data as any;
    expect(data.method).toBe('Runtime.evaluate');
    expect(data.result.json).toContain('42');
    expect(sends[0]).toContain('Runtime.evaluate');
  });

  it('proxies a bounded batch of page-target CDP calls', async () => {
    mockFetch([{ id: '1', type: 'page', webSocketDebuggerUrl: 'ws://cdp/1' }]);
    const sends = mockWebSocket({ ok: true });
    const data = (await browserCdpBatch(controlWorkspace(), '1', [{ method: 'Page.enable' }, { method: 'Runtime.enable' }])).data as any;
    expect(data.results).toHaveLength(2);
    expect(sends[0]).toContain('Page.enable');
    expect(sends[1]).toContain('Runtime.enable');
  });



  it('supports delay steps in CDP batches', async () => {
    mockFetch([{ id: '1', type: 'page', webSocketDebuggerUrl: 'ws://cdp/1' }]);
    const sends = mockWebSocket({ ok: true });
    const data = (await browserCdpBatch(controlWorkspace(), '1', [{ method: 'Page.enable' }, { delay_ms: 1 } as any, { method: 'Runtime.enable' }])).data as any;
    expect(data.results[1].kind).toBe('delay');
    expect(data.results[1].delay_ms).toBe(1);
    expect(sends[0]).toContain('Page.enable');
    expect(sends[1]).toContain('Runtime.enable');
  });

  it('supports page load waits on page-target CDP batch command steps', async () => {
    mockFetch([{ id: '1', type: 'page', webSocketDebuggerUrl: 'ws://cdp/1' }]);
    const sends = mockWebSocket({ frameId: 'frame-1' }, 'Page.loadEventFired');
    const data = (await browserCdpBatch(controlWorkspace(), '1', [{ method: 'Page.navigate', params: { url: 'https://example.com' }, wait_for: 'page_load', timeout_ms: 1000 } as any])).data as any;
    expect(data.results[0].wait.wait_for).toBe('page_load');
    expect(data.results[0].wait.ok).toBe(true);
    expect(sends[0]).toContain('Page.enable');
    expect(sends[1]).toContain('Page.navigate');
  });

  it('requires browser CDP control for CDP calls', async () => {
    await expect(browserCdpBrowserCall(fixtureWorkspace(), 'Browser.getVersion')).rejects.toThrow('browser CDP control is not enabled');
    await expect(browserCdpCall(fixtureWorkspace(), '1', 'Runtime.evaluate')).rejects.toThrow('browser CDP control is not enabled');
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

function response(body: unknown) {
  return { ok: true, json: async () => body, text: async () => String(body) };
}

function mockWebSocket(result: unknown, eventMethod?: string) {
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
      setTimeout(() => {
        this.dispatchEvent(event);
        if (eventMethod) this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ method: eventMethod, params: {} }) }));
      }, 0);
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
