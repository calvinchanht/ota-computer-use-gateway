import { describe, expect, it } from 'vitest';
import type { Workspace } from '../src/core/workspaces.js';
import { windowsClick, windowsClipboardGet, windowsScreenshot, windowsTypeText } from '../src/tools/windowsComputer.js';

describe('windows computer-use capability gates', () => {
  it('rejects screenshots when screenshot authority is disabled', async () => {
    await expect(windowsScreenshot(fixtureWorkspace({ allow_screenshot: false }))).rejects.toThrow('allow_screenshot');
  });

  it('rejects mouse actions when mouse authority is disabled', async () => {
    await expect(windowsClick(fixtureWorkspace({ allow_mouse: false }), 10, 10)).rejects.toThrow('allow_mouse');
  });

  it('rejects keyboard actions when keyboard authority is disabled', async () => {
    await expect(windowsTypeText(fixtureWorkspace({ allow_keyboard: false }), 'hello')).rejects.toThrow('allow_keyboard');
  });

  it('rejects clipboard reads when clipboard authority is disabled', async () => {
    await expect(windowsClipboardGet(fixtureWorkspace({ allow_clipboard: false }))).rejects.toThrow('allow_clipboard');
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
