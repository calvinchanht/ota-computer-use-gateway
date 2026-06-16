import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Workspace } from '../src/core/workspaces.js';
import { windowsScreenshot } from '../src/tools/windowsComputer.js';

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
  beforeEach(() => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
    process.env.OTA_GATEWAY_PUBLIC_BASE_URL = 'https://gateway.example.test/';
    mocks.execFileAsync.mockResolvedValue({ stdout: JSON.stringify({ monitor: 'primary', path: 'captured.png' }), stderr: '' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.OTA_GATEWAY_PUBLIC_BASE_URL;
  });

  it('returns provider-fetchable URLs for full and preview images', async () => {
    const result = await windowsScreenshot(fixtureWorkspace(), 'primary');
    const artifact = (result.data as any).artifact;
    expect(artifact.full.url_path).toContain('/api/v1/artifacts/windows/');
    expect(artifact.preview.url_path).toContain('/api/v1/artifacts/windows/');
    expect(artifact.full.url).toBe(`https://gateway.example.test${artifact.full.url_path}`);
    expect(artifact.preview.url).toBe(`https://gateway.example.test${artifact.preview.url_path}`);
  });
});

function fixtureWorkspace(): Workspace {
  const root = 'D:/tmp/windows';
  return {
    id: 'windows',
    name: 'Windows',
    root,
    realRoot: root,
    realAgentDir: `${root}/.agent`,
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
