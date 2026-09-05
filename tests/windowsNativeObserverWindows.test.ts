import { describe, expect, it } from 'vitest';
import type { Workspace } from '../src/core/workspaces.js';
import {
  WINDOWS_NATIVE_OBSERVER_ALLOWED_EVENTS,
  WINDOWS_NATIVE_OBSERVER_EVENT_CAP,
  WINDOWS_NATIVE_OBSERVER_TIMEOUT_MS,
  windowsObserveNativeEvents
} from '../src/tools/windowsNativeObserver.js';

const targetPid = Number(process.env.OTA_NATIVE_OBSERVER_TEST_PID ?? 0);
const targetHwnd = Number(process.env.OTA_NATIVE_OBSERVER_TEST_HWND ?? 0);
const enabled = process.platform === 'win32' && Number.isSafeInteger(targetPid) && targetPid > 0 && Number.isSafeInteger(targetHwnd) && targetHwnd > 0;
const integrationDescribe = enabled ? describe : describe.skip;

integrationDescribe('Windows native observer owned-Studio integration', () => {
  it('refuses a mismatched PID/HWND target before hooks or capture', async () => {
    expect(process.pid).not.toBe(targetPid);
    const started = Date.now();
    await expect(windowsObserveNativeEvents(fixtureWorkspace(), process.pid, targetHwnd))
      .rejects.toThrow(/native observer target PID\/HWND mismatch/);
    expect(Date.now() - started).toBeLessThan(WINDOWS_NATIVE_OBSERVER_TIMEOUT_MS);
  }, WINDOWS_NATIVE_OBSERVER_TIMEOUT_MS + 10000);

  it('captures ordered bounded L/R mouse delivery and allowed WinEvent lifecycle correlation without launching or driving the target', async () => {
    const result = await windowsObserveNativeEvents(fixtureWorkspace(), targetPid, targetHwnd);
    const data = (result as any).data as Record<string, any>;
    const records = Array.isArray(data.records) ? data.records as Array<Record<string, any>> : [];

    expect(data.timeout_ms).toBe(WINDOWS_NATIVE_OBSERVER_TIMEOUT_MS);
    expect(data.event_cap).toBe(WINDOWS_NATIVE_OBSERVER_EVENT_CAP);
    expect(records.length).toBeLessThanOrEqual(WINDOWS_NATIVE_OBSERVER_EVENT_CAP);
    expect(records.map((record) => record.sequence)).toEqual(records.map((_, index) => index + 1));
    for (let index = 1; index < records.length; index++) {
      expect(records[index].monotonic_ms).toBeGreaterThanOrEqual(records[index - 1].monotonic_ms);
    }

    const mouse = records.filter((record) => record.source === 'mouse_ll');
    expect(mouse.map((record) => record.button)).toEqual(expect.arrayContaining(['left', 'right']));
    expect(mouse.every((record) => ['down', 'up'].includes(record.state))).toBe(true);
    expect(mouse.every((record) => record.pid === targetPid)).toBe(true);

    const allowedWinEventNames = new Set(Object.keys(WINDOWS_NATIVE_OBSERVER_ALLOWED_EVENTS));
    const winEvents = records.filter((record) => record.source === 'winevent');
    expect(winEvents.length).toBeGreaterThan(0);
    expect(winEvents.every((record) => allowedWinEventNames.has(record.win_event_name))).toBe(true);
    expect(winEvents.every((record) => record.pid === targetPid)).toBe(true);
  }, WINDOWS_NATIVE_OBSERVER_TIMEOUT_MS + 10000);
});

function fixtureWorkspace(): Workspace {
  return {
    id: 'native-observer-test', name: 'Native observer Windows test', root: 'C:\\', realRoot: 'C:\\', realAgentDir: 'C:\\.agent',
    allow_read: false, allow_write: false, allow_patch: false, allow_tests: false, allow_screen: false, allow_mouse_keyboard: false,
    api_sets: { computer_windows: true }, browser: { profiles: [] }, commands: {}, filesystem: { machine_admin_host_scope: false, host_root: 'C:\\' },
    windows_computer: {
      enabled: true,
      allow_screenshot: false,
      allow_uia_tree: false,
      allow_mouse: false,
      allow_keyboard: false,
      allow_clipboard: false,
      allow_window_management: false,
      allow_app_launch: false,
      allow_process_attach: false,
      allow_native_event_observer: true,
      allow_multi_monitor: false
    },
    ota_memory: { enabled: false, python_executable: 'python', user_id: '', scope_type: 'project', privacy: 'project_only', timeout_ms: 30000 }
  } as Workspace;
}
