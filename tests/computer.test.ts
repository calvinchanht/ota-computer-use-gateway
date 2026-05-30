import { describe, expect, it } from 'vitest';
import type { Workspace } from '../src/core/workspaces.js';
import { computerCuaCall, computerStatus, observeAfter, observeScreen } from '../src/tools/computer.js';

describe('computer tools', () => {
  it('reports computer-use capability status', async () => {
    const result = await computerStatus(fixtureWorkspace({ allow_screen: true }));
    const data = result.data as any;
    expect(data.capabilities.screen).toBe(true);
    expect(data.capabilities.observe_after).toBe(true);
  });

  it('refuses screen observation when disabled', async () => {
    await expect(observeScreen(fixtureWorkspace())).rejects.toThrow('screen observation is not enabled');
  });

  it('returns pending observation shape when enabled', async () => {
    const result = await observeScreen(fixtureWorkspace({ allow_screen: true }));
    const data = result.data as any;
    expect(data.adapter_status).toBe('pending');
    expect(data.screenshot).toBeNull();
  });

  it('supports bounded observe_after delay and observation request', async () => {
    const data = await observeAfter(fixtureWorkspace({ allow_screen: true }), { delay_ms: 1, screenshot: true });
    expect((data as any).adapter_status).toBe('pending');
  });

  it('requires screen permission for read-only cua proxy calls', async () => {
    await expect(computerCuaCall(fixtureWorkspace(), 'list_windows')).rejects.toThrow('screen observation is not enabled');
  });

  it('requires mouse/keyboard permission for mutating cua proxy calls', async () => {
    await expect(computerCuaCall(fixtureWorkspace({ allow_screen: true }), 'press_key', { pid: 123, key: 'return' })).rejects.toThrow('mouse/keyboard control is not enabled');
  });

  it('rejects non-allowlisted cua proxy tools', async () => {
    await expect(computerCuaCall(fixtureWorkspace({ allow_screen: true, allow_mouse_keyboard: true }), 'shell')).rejects.toThrow('cua tool is not allowed');
  });
});

function fixtureWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: 'computer',
    name: 'Computer Test',
    root: '/tmp',
    realRoot: '/tmp',
    allow_read: true,
    allow_write: false,
    allow_patch: false,
    allow_tests: false,
    allow_screen: false,
    allow_mouse_keyboard: false,
    browser: { profiles: [] },
    commands: {},
    ...overrides
  };
}
