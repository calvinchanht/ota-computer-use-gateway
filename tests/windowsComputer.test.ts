import { describe, expect, it } from 'vitest';
import type { Workspace } from '../src/core/workspaces.js';
import { windowsBatch, windowsClick, windowsClipboardGet, windowsFocusWindow, windowsLaunchApp, windowsScreenshot, windowsTypeText, windowsUiaTree, windowsWindowClick } from '../src/tools/windowsComputer.js';

describe('windows computer-use capability gates', () => {
  it('rejects screenshots when screenshot authority is disabled', async () => {
    await expect(windowsScreenshot(fixtureWorkspace({ allow_screenshot: false }))).rejects.toThrow('allow_screenshot');
  });

  it('rejects mouse actions when mouse authority is disabled', async () => {
    await expect(windowsClick(fixtureWorkspace({ allow_mouse: false }), 10, 10)).rejects.toThrow('allow_mouse');
    await expect(windowsWindowClick(fixtureWorkspace({ allow_mouse: false }), 1, 10, 10)).rejects.toThrow('allow_mouse');
  });

  it('rejects window mouse actions when window authority is disabled', async () => {
    await expect(windowsWindowClick(fixtureWorkspace({ allow_window_management: false }), 1, 10, 10)).rejects.toThrow('allow_window_management');
  });

  it('rejects keyboard actions when keyboard authority is disabled', async () => {
    await expect(windowsTypeText(fixtureWorkspace({ allow_keyboard: false }), 'hello')).rejects.toThrow('allow_keyboard');
  });

  it('rejects clipboard reads when clipboard authority is disabled', async () => {
    await expect(windowsClipboardGet(fixtureWorkspace({ allow_clipboard: false }))).rejects.toThrow('allow_clipboard');
  });

  it('rejects malformed mouse arguments before host execution', async () => {
    await expect(windowsClick(fixtureWorkspace(), Number.NaN, 10)).rejects.toThrow('x must be a finite number');
    await expect(windowsClick(fixtureWorkspace(), 10, 10, 'middle')).rejects.toThrow('button must be left or right');
    await expect(windowsWindowClick(fixtureWorkspace(), 1, 10, 10, 'left', 'screen')).rejects.toThrow('coordinate_space must be client or window');
  });

  it('rejects malformed window and UIA arguments before host execution', async () => {
    await expect(windowsFocusWindow(fixtureWorkspace(), 1.5)).rejects.toThrow('hwnd must be an integer');
    await expect(windowsUiaTree(fixtureWorkspace(), 0)).rejects.toThrow('max_nodes must be between 1 and 1000');
    await expect(windowsUiaTree(fixtureWorkspace(), 1001)).rejects.toThrow('max_nodes must be between 1 and 1000');
  });

  it('rejects empty app launch paths before host execution', async () => {
    await expect(windowsLaunchApp(fixtureWorkspace(), '   ')).rejects.toThrow('file_path must be a non-empty string');
  });

  it('stops Windows batches on the first command authorization error', async () => {
    const result = await windowsBatch(fixtureWorkspace({ allow_mouse: false }), [
      { tool: 'click', args: { x: 10, y: 10 } },
      { tool: 'type_text', args: { text: 'must not run' } }
    ]);
    const data = result.data as { results: { error?: string }[]; stopped_on_error: { error?: string } };
    expect(data.results).toHaveLength(1);
    expect(data.results[0].error).toContain('allow_mouse');
    expect(data.stopped_on_error.error).toContain('allow_mouse');
  });

  it('keeps delay-only Windows batch steps bounded and successful', async () => {
    const result = await windowsBatch(fixtureWorkspace({ enabled: false }), [{ delay_ms: 1 }]);
    const data = result.data as { results: unknown[]; stopped_on_error: unknown };
    expect(data.results).toHaveLength(1);
    expect(data.results[0]).toMatchObject({ index: 0, kind: 'delay', delay_ms: 1 });
    expect(data.stopped_on_error).toBeNull();
  });

  it('rejects empty and oversized Windows batches', async () => {
    await expect(windowsBatch(fixtureWorkspace(), [])).rejects.toThrow('requires at least one step');
    const calls = Array.from({ length: 51 }, () => ({ delay_ms: 0 }));
    await expect(windowsBatch(fixtureWorkspace(), calls)).rejects.toThrow('at most 50 steps');
  });
});

function fixtureWorkspace(windowsOverrides: Partial<Workspace['windows_computer']> = {}): Workspace {
  return {
    id: 'windows',
    name: 'Windows',
    root: '/tmp/windows',
    realRoot: '/tmp/windows',
    realAgentDir: '/tmp/windows/.agent',
    allow_read: true,
    allow_write: false,
    allow_patch: false,
    allow_tests: false,
    allow_screen: false,
    allow_mouse_keyboard: false,
    browser: { profiles: [] },
    commands: {},
    windows_computer: {
      enabled: true,
      allow_screenshot: true,
      allow_uia_tree: true,
      allow_mouse: true,
      allow_keyboard: true,
      allow_clipboard: true,
      allow_window_management: true,
      allow_app_launch: true,
      allow_process_attach: false,
      allow_multi_monitor: true,
      ...windowsOverrides
    }
  };
}
