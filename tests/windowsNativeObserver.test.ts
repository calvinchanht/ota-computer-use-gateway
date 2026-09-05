import { describe, expect, it } from 'vitest';
import type { Workspace } from '../src/core/workspaces.js';
import { registerComputerTools } from '../src/server/register/computer.js';
import { allowedTools } from '../src/tools/policy.js';
import {
  WINDOWS_NATIVE_OBSERVER_ALLOWED_EVENTS,
  WINDOWS_NATIVE_OBSERVER_EVENT_CAP,
  WINDOWS_NATIVE_OBSERVER_TIMEOUT_MS,
  windowsNativeObserverPowerShellForTest
} from '../src/tools/windowsNativeObserver.js';

describe('bounded Windows native observer contract', () => {
  it('fixes the only WinEvent allowlist and server-owned timeout/output bounds', () => {
    expect(WINDOWS_NATIVE_OBSERVER_ALLOWED_EVENTS).toEqual({
      EVENT_SYSTEM_MENUPOPUPSTART: 0x0006,
      EVENT_SYSTEM_MENUPOPUPEND: 0x0007,
      EVENT_OBJECT_CREATE: 0x8000,
      EVENT_OBJECT_DESTROY: 0x8001,
      EVENT_OBJECT_SHOW: 0x8002,
      EVENT_OBJECT_HIDE: 0x8003
    });
    expect(Object.keys(WINDOWS_NATIVE_OBSERVER_ALLOWED_EVENTS)).toHaveLength(6);
    expect(WINDOWS_NATIVE_OBSERVER_TIMEOUT_MS).toBe(4000);
    expect(WINDOWS_NATIVE_OBSERVER_EVENT_CAP).toBe(128);
  });

  it('registers a READ_ONLY narrow schema with no caller-selectable event, timeout, cap, script, or command input', () => {
    const tools = new Map<string, Record<string, any>>();
    const server = {
      registerTool(name: string, spec: Record<string, unknown>, handler: unknown) {
        tools.set(name, { spec, handler });
      }
    };
    registerComputerTools({ server: server as any, workspaces: new Map(), config: {} as any });
    const spec = tools.get('windows_observe_native_events')?.spec as Record<string, any> | undefined;
    expect(spec).toBeDefined();
    expect(spec?.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false, openWorldHint: false });
    expect(Object.keys(spec?.inputSchema ?? {})).toEqual(['workspace_id', 'pid', 'hwnd']);
  });

  it('requires the explicit observer right; generic process attach authority is insufficient', () => {
    const processAttachOnly = fixtureWorkspace({ allow_process_attach: true, allow_native_event_observer: false });
    const explicitObserver = fixtureWorkspace({ allow_process_attach: false, allow_native_event_observer: true });
    expect(allowedTools(processAttachOnly, 'windows')).not.toContain('windows_observe_native_events');
    expect(allowedTools(explicitObserver, 'windows')).toContain('windows_observe_native_events');
  });

  it('builds a fixed first-party observer that validates owned Studio PID/HWND before installing hooks', () => {
    const script = windowsNativeObserverPowerShellForTest(1234, 5678);
    expect(script).toContain('GetAncestor(hwnd, GA_ROOT) != hwnd');
    expect(script).toContain('GetWindowThreadProcessId(hwnd, out hwndPid)');
    expect(script).toContain('if (hwndPid != pid)');
    expect(script).toContain('target.ProcessName, "RobloxStudioBeta"');
    expect(script).toContain('target.SessionId != Process.GetCurrentProcess().SessionId');
    expect(script).toContain('!String.Equals(currentSid, targetSid, StringComparison.Ordinal)');
    expect(script.indexOf('ValidateTarget(pid, hwnd);')).toBeLessThan(script.indexOf('SetWindowsHookEx(WH_MOUSE_LL'));
  });

  it('uses only L/R WH_MOUSE_LL delivery and exact process-scoped WINEVENT_OUTOFCONTEXT hooks', () => {
    const script = windowsNativeObserverPowerShellForTest(1234, 5678);
    expect(script).toContain('private const int WH_MOUSE_LL = 13;');
    expect(script).toContain('WM_LBUTTONDOWN');
    expect(script).toContain('WM_LBUTTONUP');
    expect(script).toContain('WM_RBUTTONDOWN');
    expect(script).toContain('WM_RBUTTONUP');
    expect(script).toContain('SetWinEventHook(eventId, eventId, IntPtr.Zero, WinEventProcRef, pid, 0, WINEVENT_OUTOFCONTEXT)');
    expect(script).toContain('if (!AllowedWinEvents.Contains(eventType)');
    expect(script).toContain('if (pid != 0 && pid != TargetPid) return;');
    expect(script).toContain('IsTargetBoundaryWindow(hwnd, true)');
    expect(script).toContain('pid == TargetPid && IsTargetBoundaryWindow(hit, false)');
  });

  it('contains no keyboard, input-synthesis, raw-message, remote-injection, network, persistence, or arbitrary payload path', () => {
    const script = windowsNativeObserverPowerShellForTest(1234, 5678);
    for (const forbidden of [
      'WH_KEYBOARD', 'SendInput', 'mouse_event', 'keybd_event', 'SendMessage', 'PostMessage',
      'WriteProcessMemory', 'ReadProcessMemory', 'CreateRemoteThread', 'VirtualAllocEx', 'LoadLibrary',
      'WebClient', 'HttpClient', 'Invoke-WebRequest', 'Start-Process', 'Set-Content', 'Add-Content',
      'GetWindowText', 'GetEnvironmentVariable', 'Credential'
    ]) expect(script, forbidden).not.toContain(forbidden);
    expect(script).not.toContain('param(');
  });

  it('embeds fixed bounds into the native call and stops the message pump on timeout or event cap', () => {
    const script = windowsNativeObserverPowerShellForTest(1234, 5678);
    expect(script).toContain(`if (timeoutMs != ${WINDOWS_NATIVE_OBSERVER_TIMEOUT_MS})`);
    expect(script).toContain(`if (eventCap != ${WINDOWS_NATIVE_OBSERVER_EVENT_CAP})`);
    expect(script).toContain('Clock.ElapsedMilliseconds < timeoutMs && RecordCount() < eventCap');
    expect(script).toContain('if (Records.Count >= EventCap) return;');
    expect(script).toContain(`[OtaBoundedNativeObserver]::Observe([uint32]1234, [int64]5678, ${WINDOWS_NATIVE_OBSERVER_TIMEOUT_MS}, ${WINDOWS_NATIVE_OBSERVER_EVENT_CAP})`);
  });
});

function fixtureWorkspace(windowsOverrides: Partial<NonNullable<Workspace['windows_computer']>> = {}): Workspace {
  return {
    id: 'test', name: 'Test', root: '/tmp/test', realRoot: '/tmp/test', realAgentDir: '/tmp/test/.agent',
    allow_read: true, allow_write: false, allow_patch: false, allow_tests: false, allow_screen: false, allow_mouse_keyboard: false,
    api_sets: { computer_windows: true }, browser: { profiles: [] }, commands: {}, filesystem: { machine_admin_host_scope: false, host_root: '/' },
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
      allow_native_event_observer: false,
      allow_multi_monitor: true,
      ...windowsOverrides
    },
    ota_memory: { enabled: false, python_executable: 'python', user_id: '', scope_type: 'project', privacy: 'project_only', timeout_ms: 30000 }
  } as Workspace;
}
