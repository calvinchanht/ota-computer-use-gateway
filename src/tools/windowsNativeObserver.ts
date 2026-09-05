import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Workspace } from '../core/workspaces.js';
import { ok } from '../core/result.js';

const execFileAsync = promisify(execFile);
const MAX_OBSERVER_BUFFER = 2 * 1024 * 1024;

export const WINDOWS_NATIVE_OBSERVER_TIMEOUT_MS = 4000;
export const WINDOWS_NATIVE_OBSERVER_EVENT_CAP = 128;
export const WINDOWS_NATIVE_OBSERVER_ALLOWED_EVENTS = Object.freeze({
  EVENT_SYSTEM_MENUPOPUPSTART: 0x0006,
  EVENT_SYSTEM_MENUPOPUPEND: 0x0007,
  EVENT_OBJECT_CREATE: 0x8000,
  EVENT_OBJECT_DESTROY: 0x8001,
  EVENT_OBJECT_SHOW: 0x8002,
  EVENT_OBJECT_HIDE: 0x8003
} as const);

const OBSERVER_PROCESS_TIMEOUT_MS = WINDOWS_NATIVE_OBSERVER_TIMEOUT_MS + 5000;

export async function windowsObserveNativeEvents(workspace: Workspace, pid: number, hwnd: number) {
  ensureObserverEnabled(workspace);
  const targetPid = positiveInteger(pid, 'pid');
  const targetHwnd = positiveInteger(hwnd, 'hwnd');
  ensureWindows();
  const data = await observeNativeEvents(targetPid, targetHwnd);
  return ok('windows native events observed', data);
}

export function windowsNativeObserverPowerShellForTest(pid: number, hwnd: number): string {
  return observerPowerShell(positiveInteger(pid, 'pid'), positiveInteger(hwnd, 'hwnd'));
}

function ensureObserverEnabled(workspace: Workspace): void {
  if (!workspace.windows_computer?.enabled) throw new Error('windows computer-use is not enabled for this workspace');
  if (!workspace.windows_computer.allow_native_event_observer) throw new Error('windows computer-use capability disabled: allow_native_event_observer');
}

function ensureWindows(): void {
  if (process.platform !== 'win32') throw new Error('windows native event observer requires a Windows host');
}

function positiveInteger(value: unknown, name: string): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new Error(`${name} must be a positive safe integer`);
  return number;
}

async function observeNativeEvents(pid: number, hwnd: number): Promise<Record<string, unknown>> {
  const script = powershellJsonScript(observerPowerShell(pid, hwnd));
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const { stdout, stderr } = await execFileAsync('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Sta',
    '-ExecutionPolicy',
    'Bypass',
    '-EncodedCommand',
    encoded
  ], {
    timeout: OBSERVER_PROCESS_TIMEOUT_MS,
    maxBuffer: MAX_OBSERVER_BUFFER,
    windowsHide: true
  });
  const text = stdout.trim();
  if (!text) throw new Error(`native observer returned no JSON${stderr.trim() ? `: ${stderr.trim()}` : ''}`);
  const parsed: unknown = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('native observer did not return an object');
  return parsed as Record<string, unknown>;
}

function powershellJsonScript(script: string): string {
  return `$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; [Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false); $OutputEncoding=[Console]::OutputEncoding; ${script}`;
}

function observerPowerShell(pid: number, hwnd: number): string {
  return `$source=@'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Threading;

public static class OtaBoundedNativeObserver
{
    private const int WH_MOUSE_LL = 13;
    private const uint WM_LBUTTONDOWN = 0x0201;
    private const uint WM_LBUTTONUP = 0x0202;
    private const uint WM_RBUTTONDOWN = 0x0204;
    private const uint WM_RBUTTONUP = 0x0205;
    private const uint EVENT_SYSTEM_MENUPOPUPSTART = 0x0006;
    private const uint EVENT_SYSTEM_MENUPOPUPEND = 0x0007;
    private const uint EVENT_OBJECT_CREATE = 0x8000;
    private const uint EVENT_OBJECT_DESTROY = 0x8001;
    private const uint EVENT_OBJECT_SHOW = 0x8002;
    private const uint EVENT_OBJECT_HIDE = 0x8003;
    private const uint WINEVENT_OUTOFCONTEXT = 0x0000;
    private const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
    private const uint SYNCHRONIZE = 0x00100000;
    private const uint WAIT_TIMEOUT = 0x00000102;
    private const uint TOKEN_QUERY = 0x0008;
    private const uint PM_REMOVE = 0x0001;
    private const int OBJID_WINDOW = 0;
    private const int CHILDID_SELF = 0;
    private const uint GA_ROOT = 2;
    private const uint GA_ROOTOWNER = 3;

    private static readonly HashSet<uint> AllowedWinEvents = new HashSet<uint>
    {
        EVENT_SYSTEM_MENUPOPUPSTART,
        EVENT_SYSTEM_MENUPOPUPEND,
        EVENT_OBJECT_CREATE,
        EVENT_OBJECT_DESTROY,
        EVENT_OBJECT_SHOW,
        EVENT_OBJECT_HIDE
    };

    private static readonly Dictionary<uint, string> WinEventNames = new Dictionary<uint, string>
    {
        { EVENT_SYSTEM_MENUPOPUPSTART, "EVENT_SYSTEM_MENUPOPUPSTART" },
        { EVENT_SYSTEM_MENUPOPUPEND, "EVENT_SYSTEM_MENUPOPUPEND" },
        { EVENT_OBJECT_CREATE, "EVENT_OBJECT_CREATE" },
        { EVENT_OBJECT_DESTROY, "EVENT_OBJECT_DESTROY" },
        { EVENT_OBJECT_SHOW, "EVENT_OBJECT_SHOW" },
        { EVENT_OBJECT_HIDE, "EVENT_OBJECT_HIDE" }
    };

    private static readonly object Gate = new object();
    private static readonly List<Dictionary<string, object>> Records = new List<Dictionary<string, object>>();
    private static readonly HashSet<long> KnownBoundaryWindows = new HashSet<long>();
    private static Stopwatch Clock = new Stopwatch();
    private static uint TargetPid;
    private static IntPtr TargetHwnd;
    private static uint TargetWindowThreadId;
    private static IntPtr TargetProcessHandle;
    private static volatile bool TargetLost;
    private static int EventCap;
    private static MouseHookProc MouseProcRef;
    private static WinEventProc WinEventProcRef;

    [StructLayout(LayoutKind.Sequential)]
    private struct POINT { public int x; public int y; }

    [StructLayout(LayoutKind.Sequential)]
    private struct MSLLHOOKSTRUCT
    {
        public POINT pt;
        public uint mouseData;
        public uint flags;
        public uint time;
        public UIntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MSG
    {
        public IntPtr hwnd;
        public uint message;
        public UIntPtr wParam;
        public IntPtr lParam;
        public uint time;
        public POINT pt;
        public uint lPrivate;
    }

    private delegate IntPtr MouseHookProc(int nCode, IntPtr wParam, IntPtr lParam);
    private delegate void WinEventProc(IntPtr hook, uint eventType, IntPtr hwnd, int objectId, int childId, uint eventThread, uint eventTime);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr SetWindowsHookEx(int hookId, MouseHookProc callback, IntPtr module, uint threadId);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool UnhookWindowsHookEx(IntPtr hook);

    [DllImport("user32.dll")]
    private static extern IntPtr CallNextHookEx(IntPtr hook, int nCode, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr SetWinEventHook(uint eventMin, uint eventMax, IntPtr module, WinEventProc callback, uint processId, uint threadId, uint flags);

    [DllImport("user32.dll")]
    private static extern bool UnhookWinEvent(IntPtr hook);

    [DllImport("user32.dll")]
    private static extern bool IsWindow(IntPtr hwnd);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);

    [DllImport("user32.dll")]
    private static extern IntPtr WindowFromPoint(POINT point);

    [DllImport("user32.dll")]
    private static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);

    [DllImport("user32.dll")]
    private static extern bool IsChild(IntPtr parent, IntPtr child);

    [DllImport("user32.dll")]
    private static extern bool PeekMessage(out MSG message, IntPtr hwnd, uint min, uint max, uint remove);

    [DllImport("user32.dll")]
    private static extern bool TranslateMessage(ref MSG message);

    [DllImport("user32.dll")]
    private static extern IntPtr DispatchMessage(ref MSG message);

    [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    private static extern IntPtr GetModuleHandle(string moduleName);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr OpenProcess(uint access, bool inheritHandle, uint processId);

    [DllImport("kernel32.dll")]
    private static extern uint GetProcessId(IntPtr process);

    [DllImport("kernel32.dll")]
    private static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);

    [DllImport("kernel32.dll")]
    private static extern bool CloseHandle(IntPtr handle);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool OpenProcessToken(IntPtr processHandle, uint desiredAccess, out IntPtr tokenHandle);

    public static object Observe(uint pid, long hwndValue, int timeoutMs, int eventCap)
    {
        if (timeoutMs != ${WINDOWS_NATIVE_OBSERVER_TIMEOUT_MS}) throw new InvalidOperationException("observer timeout is server-fixed");
        if (eventCap != ${WINDOWS_NATIVE_OBSERVER_EVENT_CAP}) throw new InvalidOperationException("observer event cap is server-fixed");
        IntPtr hwnd = new IntPtr(hwndValue);
        uint targetWindowThreadId;
        IntPtr targetProcessHandle = ValidateAndPinTarget(pid, hwnd, out targetWindowThreadId);
        IntPtr mouseHook = IntPtr.Zero;
        var winEventHooks = new List<IntPtr>();
        string endedReason = "timeout";

        try
        {
            lock (Gate)
            {
                Records.Clear();
                KnownBoundaryWindows.Clear();
                KnownBoundaryWindows.Add(hwnd.ToInt64());
            }
            TargetPid = pid;
            TargetHwnd = hwnd;
            TargetWindowThreadId = targetWindowThreadId;
            TargetProcessHandle = targetProcessHandle;
            TargetLost = false;
            EventCap = eventCap;
            MouseProcRef = MouseCallback;
            WinEventProcRef = WinEventCallback;
            Clock = Stopwatch.StartNew();

            if (!EnsureTargetIdentity()) throw new InvalidOperationException("native observer target identity lost before hook installation");

            IntPtr module = GetModuleHandle(null);
            mouseHook = SetWindowsHookEx(WH_MOUSE_LL, MouseProcRef, module, 0);
            if (mouseHook == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error(), "failed to install WH_MOUSE_LL observer");

            foreach (uint eventId in AllowedWinEvents)
            {
                IntPtr hook = SetWinEventHook(eventId, eventId, IntPtr.Zero, WinEventProcRef, pid, 0, WINEVENT_OUTOFCONTEXT);
                if (hook == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error(), "failed to install bounded WinEvent observer");
                winEventHooks.Add(hook);
            }

            while (Clock.ElapsedMilliseconds < timeoutMs && RecordCount() < eventCap)
            {
                if (!EnsureTargetIdentity()) { endedReason = "target_lost"; break; }
                MSG message;
                while (PeekMessage(out message, IntPtr.Zero, 0, 0, PM_REMOVE))
                {
                    TranslateMessage(ref message);
                    DispatchMessage(ref message);
                }
                if (!EnsureTargetIdentity()) { endedReason = "target_lost"; break; }
                Thread.Sleep(4);
            }
            if (TargetLost) endedReason = "target_lost";
            else if (RecordCount() >= eventCap) endedReason = "event_cap";

            Dictionary<string, object>[] records;
            lock (Gate) records = Records.ToArray();
            return new
            {
                target = new { pid = pid, hwnd = hwndValue, studio_process = "RobloxStudioBeta", same_user = true, same_session = true },
                timeout_ms = timeoutMs,
                event_cap = eventCap,
                event_count = records.Length,
                truncated = records.Length >= eventCap,
                ended_reason = endedReason,
                allowed_win_events = new[]
                {
                    "EVENT_SYSTEM_MENUPOPUPSTART",
                    "EVENT_SYSTEM_MENUPOPUPEND",
                    "EVENT_OBJECT_CREATE",
                    "EVENT_OBJECT_DESTROY",
                    "EVENT_OBJECT_SHOW",
                    "EVENT_OBJECT_HIDE"
                },
                records = records
            };
        }
        finally
        {
            if (mouseHook != IntPtr.Zero) UnhookWindowsHookEx(mouseHook);
            foreach (IntPtr hook in winEventHooks) if (hook != IntPtr.Zero) UnhookWinEvent(hook);
            Clock.Stop();
            TargetProcessHandle = IntPtr.Zero;
            CloseHandle(targetProcessHandle);
        }
    }

    private static IntPtr ValidateAndPinTarget(uint pid, IntPtr hwnd, out uint windowThreadId)
    {
        windowThreadId = 0;
        if (pid == 0 || hwnd == IntPtr.Zero || !IsWindow(hwnd)) throw new InvalidOperationException("native observer target must be an existing Studio PID/HWND");
        if (GetAncestor(hwnd, GA_ROOT) != hwnd) throw new InvalidOperationException("native observer target HWND must be a top-level Studio window");
        uint hwndPid;
        uint hwndThreadId = GetWindowThreadProcessId(hwnd, out hwndPid);
        if (hwndThreadId == 0 || hwndPid != pid) throw new InvalidOperationException("native observer target PID/HWND mismatch");

        IntPtr process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE, false, pid);
        if (process == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error(), "cannot pin native observer target process");
        try
        {
            if (GetProcessId(process) != pid || WaitForSingleObject(process, 0) != WAIT_TIMEOUT)
                throw new InvalidOperationException("native observer target PID is not running");

            Process target;
            try { target = Process.GetProcessById((int)pid); }
            catch { throw new InvalidOperationException("native observer target PID is not running"); }
            if (target.HasExited || !String.Equals(target.ProcessName, "RobloxStudioBeta", StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("native observer target must be RobloxStudioBeta");
            if (target.SessionId != Process.GetCurrentProcess().SessionId)
                throw new InvalidOperationException("native observer target is not owned by the gateway Windows session");

            string currentSid = WindowsIdentity.GetCurrent().User == null ? "" : WindowsIdentity.GetCurrent().User.Value;
            string targetSid = ProcessUserSid(process);
            if (String.IsNullOrEmpty(currentSid) || !String.Equals(currentSid, targetSid, StringComparison.Ordinal))
                throw new InvalidOperationException("native observer target is not owned by the gateway Windows user");

            uint finalPid;
            uint finalThreadId = GetWindowThreadProcessId(hwnd, out finalPid);
            if (!IsWindow(hwnd) || GetAncestor(hwnd, GA_ROOT) != hwnd || finalPid != pid || finalThreadId != hwndThreadId || WaitForSingleObject(process, 0) != WAIT_TIMEOUT)
                throw new InvalidOperationException("native observer target identity changed during validation");
            windowThreadId = hwndThreadId;
            return process;
        }
        catch
        {
            CloseHandle(process);
            throw;
        }
    }

    private static string ProcessUserSid(IntPtr process)
    {
        IntPtr token;
        if (!OpenProcessToken(process, TOKEN_QUERY, out token)) throw new Win32Exception(Marshal.GetLastWin32Error(), "cannot query native observer target token");
        try
        {
            using (var identity = new WindowsIdentity(token))
                return identity.User == null ? "" : identity.User.Value;
        }
        finally { CloseHandle(token); }
    }

    private static bool EnsureTargetIdentity()
    {
        if (TargetLost) return false;
        if (TargetProcessHandle == IntPtr.Zero ||
            WaitForSingleObject(TargetProcessHandle, 0) != WAIT_TIMEOUT ||
            GetProcessId(TargetProcessHandle) != TargetPid ||
            TargetHwnd == IntPtr.Zero || !IsWindow(TargetHwnd) ||
            GetAncestor(TargetHwnd, GA_ROOT) != TargetHwnd)
        {
            TargetLost = true;
            return false;
        }

        uint hwndPid;
        uint hwndThreadId = GetWindowThreadProcessId(TargetHwnd, out hwndPid);
        if (hwndPid != TargetPid || hwndThreadId == 0 || hwndThreadId != TargetWindowThreadId)
        {
            TargetLost = true;
            return false;
        }
        return true;
    }

    private static IntPtr MouseCallback(int nCode, IntPtr wParam, IntPtr lParam)
    {
        if (nCode >= 0 && EnsureTargetIdentity() && RecordCount() < EventCap)
        {
            uint message = unchecked((uint)wParam.ToInt64());
            string button = null;
            string state = null;
            if (message == WM_LBUTTONDOWN) { button = "left"; state = "down"; }
            else if (message == WM_LBUTTONUP) { button = "left"; state = "up"; }
            else if (message == WM_RBUTTONDOWN) { button = "right"; state = "down"; }
            else if (message == WM_RBUTTONUP) { button = "right"; state = "up"; }

            if (button != null)
            {
                var info = (MSLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(MSLLHOOKSTRUCT));
                IntPtr hit = WindowFromPoint(info.pt);
                uint pid;
                uint threadId = hit == IntPtr.Zero ? 0 : GetWindowThreadProcessId(hit, out pid);
                if (hit != IntPtr.Zero)
                {
                    GetWindowThreadProcessId(hit, out pid);
                    if (pid == TargetPid && IsTargetBoundaryWindow(hit, false))
                    {
                        AddRecord(new Dictionary<string, object>
                        {
                            { "source", "mouse_ll" },
                            { "button", button },
                            { "state", state },
                            { "pid", TargetPid },
                            { "hwnd", hit.ToInt64() },
                            { "thread_id", threadId }
                        });
                    }
                }
            }
        }
        return CallNextHookEx(IntPtr.Zero, nCode, wParam, lParam);
    }

    private static void WinEventCallback(IntPtr hook, uint eventType, IntPtr hwnd, int objectId, int childId, uint eventThread, uint eventTime)
    {
        if ((eventType == EVENT_OBJECT_DESTROY || eventType == EVENT_OBJECT_CREATE) && hwnd == TargetHwnd && objectId == OBJID_WINDOW && childId == CHILDID_SELF)
        {
            TargetLost = true;
            return;
        }
        if (!EnsureTargetIdentity() || !AllowedWinEvents.Contains(eventType) || hwnd == IntPtr.Zero || RecordCount() >= EventCap) return;
        bool allowDestroyedKnownWindow = eventType == EVENT_OBJECT_DESTROY && IsKnownBoundaryWindow(hwnd);
        if (!allowDestroyedKnownWindow && !IsTargetBoundaryWindow(hwnd, true)) return;

        uint pid;
        uint windowThread = GetWindowThreadProcessId(hwnd, out pid);
        if (pid != 0 && pid != TargetPid) return;
        if (pid == 0 && !allowDestroyedKnownWindow) return;

        if (eventType == EVENT_OBJECT_CREATE || eventType == EVENT_OBJECT_SHOW || eventType == EVENT_SYSTEM_MENUPOPUPSTART)
            RememberBoundaryWindow(hwnd);

        AddRecord(new Dictionary<string, object>
        {
            { "source", "winevent" },
            { "win_event_id", eventType },
            { "win_event_name", WinEventNames[eventType] },
            { "pid", TargetPid },
            { "hwnd", hwnd.ToInt64() },
            { "object_id", objectId },
            { "child_id", childId },
            { "thread_id", eventThread != 0 ? eventThread : windowThread }
        });

        if (eventType == EVENT_OBJECT_DESTROY) ForgetBoundaryWindow(hwnd);
    }

    private static bool IsTargetBoundaryWindow(IntPtr hwnd, bool remember)
    {
        if (hwnd == IntPtr.Zero || !EnsureTargetIdentity()) return false;
        uint pid;
        GetWindowThreadProcessId(hwnd, out pid);
        if (pid != TargetPid) return false;

        bool allowed = hwnd == TargetHwnd || IsChild(TargetHwnd, hwnd);
        if (!allowed)
        {
            IntPtr root = GetAncestor(hwnd, GA_ROOT);
            IntPtr rootOwner = GetAncestor(hwnd, GA_ROOTOWNER);
            IntPtr targetRoot = GetAncestor(TargetHwnd, GA_ROOT);
            IntPtr targetRootOwner = GetAncestor(TargetHwnd, GA_ROOTOWNER);
            allowed = root == TargetHwnd || rootOwner == TargetHwnd ||
                (targetRoot != IntPtr.Zero && root == targetRoot) ||
                (targetRootOwner != IntPtr.Zero && rootOwner == targetRootOwner);
        }
        if (allowed && remember) RememberBoundaryWindow(hwnd);
        return allowed;
    }

    private static void AddRecord(Dictionary<string, object> record)
    {
        if (!EnsureTargetIdentity()) return;
        lock (Gate)
        {
            if (TargetLost || Records.Count >= EventCap) return;
            record["sequence"] = Records.Count + 1;
            record["monotonic_ms"] = Math.Round(Clock.Elapsed.TotalMilliseconds, 3);
            record["server_timestamp"] = DateTime.UtcNow.ToString("o");
            Records.Add(record);
        }
    }

    private static int RecordCount()
    {
        lock (Gate) return Records.Count;
    }

    private static void RememberBoundaryWindow(IntPtr hwnd)
    {
        lock (Gate) KnownBoundaryWindows.Add(hwnd.ToInt64());
    }

    private static bool IsKnownBoundaryWindow(IntPtr hwnd)
    {
        lock (Gate) return KnownBoundaryWindows.Contains(hwnd.ToInt64());
    }

    private static void ForgetBoundaryWindow(IntPtr hwnd)
    {
        lock (Gate) KnownBoundaryWindows.Remove(hwnd.ToInt64());
    }
}
'@; Add-Type -TypeDefinition $source -Language CSharp; [OtaBoundedNativeObserver]::Observe([uint32]${pid}, [int64]${hwnd}, ${WINDOWS_NATIVE_OBSERVER_TIMEOUT_MS}, ${WINDOWS_NATIVE_OBSERVER_EVENT_CAP}) | ConvertTo-Json -Depth 8 -Compress`;
}
