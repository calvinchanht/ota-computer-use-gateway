import { describe, expect, it } from 'vitest';
import type { Workspace } from '../src/core/workspaces.js';
import { cuaDriverBatch, cuaDriverCall, cuaDriverStatus } from '../src/tools/computer.js';

describe('cua driver proxy tools', () => {
  it('reports Cua Driver capability status', async () => {
    const result = await cuaDriverStatus(fixtureWorkspace({ allow_screen: true }));
    const data = result.data as any;
    expect(data.driver).toBe('cua-driver');
    expect(data.capabilities.screen).toBe(true);
    expect(data.allowed_methods.read_only).toContain('list_windows');
  });

  it('requires screen permission for read-only Cua Driver proxy calls', async () => {
    await expect(cuaDriverCall(fixtureWorkspace(), 'list_windows')).rejects.toThrow('screen observation is not enabled');
  });

  it('requires mouse/keyboard permission for mutating Cua Driver proxy calls', async () => {
    await expect(cuaDriverCall(fixtureWorkspace({ allow_screen: true }), 'press_key', { pid: 123, key: 'return' })).rejects.toThrow('mouse/keyboard control is not enabled');
  });

  it('rejects non-allowlisted Cua Driver methods', async () => {
    await expect(cuaDriverCall(fixtureWorkspace({ allow_screen: true, allow_mouse_keyboard: true }), 'shell')).rejects.toThrow('cua driver method is not allowed');
  });

  it('supports delay rows in Cua Driver batches without requiring screen/input permission', async () => {
    const result = await cuaDriverBatch(fixtureWorkspace(), [{ delay_ms: 1 }]);
    const data = result.data as any;
    expect(data.results[0]).toMatchObject({ index: 0, kind: 'delay', delay_ms: 1 });
  });

  it('stops Cua Driver batches on the first command authorization error', async () => {
    const result = await cuaDriverBatch(fixtureWorkspace(), [{ delay_ms: 1 }, { method: 'list_windows', params: {} }]);
    const data = result.data as any;
    expect(data.results).toHaveLength(2);
    expect(data.results[1].error).toContain('screen observation is not enabled');
    expect(data.stopped_on_error).toBeTruthy();
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
