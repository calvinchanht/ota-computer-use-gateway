import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Workspace } from '../src/core/workspaces.js';
import { windowsScreenshot, windowsWindowScreenshot } from '../src/tools/windowsComputer.js';

const mocks = vi.hoisted(() => ({
  execFile: vi.fn(),
  execFileAsync: vi.fn(),
  toFile: vi.fn(async () => undefined)
}));

vi.mock('node:child_process', () => {
  mocks.execFile[Symbol.for('nodejs.util.promisify.custom')] = mocks.execFileAsync;
  return { execFile: mocks.execFile };
});

vi.mock('sharp', () => ({
  default: vi.fn(() => ({
    resize: vi.fn(() => ({
      webp: vi.fn(() => ({ toFile: mocks.toFile }))
    }))
  }))
}));

describe('windows screenshot artifacts', () => {
  let root = '';

  beforeEach(async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
    root = await mkdtemp(path.join(os.tmpdir(), 'ota-windows-screenshot-'));
    process.env.OTA_GATEWAY_PUBLIC_BASE_URL = 'https://gateway.example.test/';
    process.env.OTA_GATEWAY_ARTIFACT_URL_SECRET = 'artifact-secret';
    mocks.execFileAsync.mockResolvedValue({ stdout: JSON.stringify({ monitor: 'primary', path: 'captured.png' }), stderr: '' });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    delete process.env.OTA_GATEWAY_PUBLIC_BASE_URL;
    delete process.env.OTA_GATEWAY_ARTIFACT_URL_SECRET;
    if (root) await rm(root, { recursive: true, force: true });
  });

  it('hides image paths and URLs from the operation response', async () => {
    const result = await windowsScreenshot(fixtureWorkspace(root), 'primary');
    const data = result.data as ScreenshotData;
    expect(data.monitor).toBe('primary');
    expect(data.path).toBeUndefined();
    expect(data.artifact).toBeUndefined();
    expect(data.preview).toBeUndefined();
    expect(data.full).toBeUndefined();
    expect(data.readable_url).toBeUndefined();
    expect(data.image_web_url).toBeUndefined();
    expect(data.web_url).toBeUndefined();
    expect(data.visual_followup.state).toBe('not_requested');
    expect(data.visual_followup.readable_url).toBeUndefined();
  });

  it('uses the same path-free response contract for hwnd screenshots', async () => {
    mocks.execFileAsync.mockResolvedValue({ stdout: JSON.stringify({ hwnd: 42, bounds: { x: 0, y: 0, width: 800, height: 600 }, capture_method: 'print_window', path: 'captured.png' }), stderr: '' });
    const workspace = fixtureWorkspace(root);
    workspace.windows_computer!.allow_window_management = true;
    const result = await windowsWindowScreenshot(workspace, 42);
    const data = result.data as ScreenshotData;
    expect(data.hwnd).toBe(42);
    expect(data.path).toBeUndefined();
    expect(data.readable_url).toBeUndefined();
    expect(data.visual_followup.state).toBe('not_requested');
  });
});

interface ScreenshotData {
  monitor?: string;
  hwnd?: number;
  bounds: Record<string, unknown>;
  path?: string;
  artifact?: unknown;
  preview?: unknown;
  full?: unknown;
  readable_url?: string;
  image_web_url?: string;
  web_url?: string;
  visual_followup: { state: string; readable_url?: string };
}

function fixtureWorkspace(root: string): Workspace {
  return {
    id: 'windows',
    name: 'Windows',
    root,
    realRoot: root,
    realAgentDir: path.join(root, '.agent'),
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
      allow_uia_tree: false,
      allow_mouse: false,
      allow_keyboard: false,
      allow_clipboard: false,
      allow_window_management: false,
      allow_app_launch: false,
      allow_process_attach: false,
      allow_multi_monitor: false
    }
  };
}
