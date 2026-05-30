import { ok } from '../core/result.js';
import { platformInfo } from '../core/platform.js';
import type { Workspace } from '../core/workspaces.js';

export type ObserveAfter = {
  delay_ms?: number;
  screenshot?: boolean;
  include_window_tree?: boolean;
};

export async function computerStatus(workspace: Workspace) {
  return ok('computer status', {
    workspace_id: workspace.id,
    platform: platformInfo(),
    capabilities: {
      screen: workspace.allow_screen,
      mouse_keyboard: workspace.allow_mouse_keyboard,
      observe_after: true
    },
    adapters: {
      screen: workspace.allow_screen ? 'pending' : 'disabled',
      mouse_keyboard: workspace.allow_mouse_keyboard ? 'pending' : 'disabled'
    }
  });
}

export async function observeScreen(workspace: Workspace) {
  if (!workspace.allow_screen) throw new Error('screen observation is not enabled for this workspace');
  return ok('screen observation adapter pending', {
    workspace_id: workspace.id,
    platform: platformInfo(),
    screenshot: null,
    window_tree: null,
    adapter_status: 'pending',
    note: 'screen observation tool shape is registered; platform adapters will provide pixels/window trees in later slices'
  });
}

export async function observeAfter(workspace: Workspace, options?: ObserveAfter) {
  if (!options) return undefined;
  const delayMs = clampDelay(options.delay_ms ?? 0);
  if (delayMs > 0) await delay(delayMs);
  if (options.screenshot || options.include_window_tree) return (await observeScreen(workspace)).data;
  return { delay_ms: delayMs };
}

function clampDelay(value: number) {
  return Math.min(Math.max(Math.trunc(value), 0), 5000);
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
