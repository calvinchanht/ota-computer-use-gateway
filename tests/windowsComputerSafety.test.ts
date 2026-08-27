import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Workspace } from '../src/core/workspaces.js';
import {
  windowsUiaRead,
  windowsUiaSetValue,
  windowsUiaTree,
  windowsWindowClick,
  windowsWindowDoubleClick,
  windowsWindowDrag,
  windowsWindowMouseMove,
  windowsWindowScroll
} from '../src/tools/windowsComputer.js';

const mocks = vi.hoisted(() => ({
  execFile: vi.fn(),
  execFileAsync: vi.fn()
}));

vi.mock('node:child_process', () => {
  mocks.execFile[Symbol.for('nodejs.util.promisify.custom')] = mocks.execFileAsync;
  return { execFile: mocks.execFile };
});

describe('windows computer UIA and hwnd input safety', () => {
  const scripts: string[] = [];

  beforeEach(() => {
    scripts.length = 0;
    mocks.execFileAsync.mockReset();
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
    mocks.execFileAsync.mockImplementation(async (_file: unknown, args: unknown) => {
      const argv = args as string[];
      const encodedIndex = argv.indexOf('-EncodedCommand');
      expect(encodedIndex).toBeGreaterThanOrEqual(0);
      const script = Buffer.from(argv[encodedIndex + 1], 'base64').toString('utf16le');
      scripts.push(script);
      if (script.includes('match_count=$matches.Count')) {
        return {
          stdout: JSON.stringify({
            hwnd: 42,
            match_count: 1,
            automation_id: 'RibbonMainWindow.startTeamTestAction',
            name: 'Start Team Test',
            control_type: 'MenuItem',
            enabled: true,
            offscreen: false,
            bounds: { x: -1804, y: 81, width: 36, height: 20 },
            bounds_finite: true,
            bounds_empty: false,
            source: 'name',
            text: 'Start Team Test',
            supported_patterns: [],
            truncated: false
          }),
          stderr: ''
        };
      }
      if (script.includes('set=$true')) {
        return {
          stdout: JSON.stringify({ hwnd: 42, automation_id: 'target', name: 'Target', control_type: 'Edit', set: true, method: 'ValuePattern', value_chars: 5 }),
          stderr: ''
        };
      }
      if (script.includes('nodes=$out')) {
        return { stdout: JSON.stringify({ hwnd: 42, nodes: [], count: 0, truncated: false }), stderr: '' };
      }
      return {
        stdout: JSON.stringify({ hwnd: 42, coordinate_space: 'client', focused: true, screen: { x: 10, y: 20 } }),
        stderr: ''
      };
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('serializes UIA rectangles with explicit finite and empty state instead of coercing non-finite coordinates', async () => {
    await windowsUiaTree(fixtureWorkspace(), 20, 42);
    const script = scripts[0];
    expect(script).toContain('function uiaFinite($v)');
    expect(script).toContain('[double]::IsNaN($d)');
    expect(script).toContain('[double]::IsInfinity($d)');
    expect(script).toContain('$bounds=$null');
    expect(script).toContain('if($finite -and -not $empty){$bounds=@{ x=[int]$r.X; y=[int]$r.Y; width=[int]$r.Width; height=[int]$r.Height }}');
    expect(script).toContain('bounds_finite=[bool]$finite');
    expect(script).toContain('bounds_empty=[bool]$empty');
    expect(script).toContain('$r.Width -le 0');
    expect(script).toContain('$r.Height -le 0');
    expect(script).not.toContain('bounds=rectObj $e.Current.BoundingRectangle');
  });

  it('covers finite, empty, Infinity, -Infinity, and NaN rectangle branches without guessed coordinates', async () => {
    await windowsUiaTree(fixtureWorkspace(), 20, 42);
    const script = scripts[0];
    const finiteBranch = script.indexOf('if($finite -and -not $empty){$bounds=@{');
    const nullBranch = script.indexOf('$bounds=$null');
    expect(nullBranch).toBeGreaterThanOrEqual(0);
    expect(finiteBranch).toBeGreaterThan(nullBranch);
    expect(script).toContain('[double]::IsNaN($d)');
    expect(script).toContain('[double]::IsInfinity($d)');
    expect(script).toContain('$empty=[bool]$r.IsEmpty');
    expect(script.match(/\[int\]\$r\.(X|Y|Width|Height)/g)).toHaveLength(4);
  });

  it('isolates a bad UIA node and continues walking later children and siblings', async () => {
    await windowsUiaTree(fixtureWorkspace(), 20, 42);
    const script = scripts[0];
    const nodeTry = script.indexOf('try{$node=nodeObj $e $d $ref}catch{');
    const faultRecord = script.indexOf('$node=@{ ref=$ref; depth=$d; fault=$message }');
    const addNode = script.indexOf('[void]$out.Add($node)');
    const recurse = script.indexOf('walk $c ($d+1) $max $out');
    const nextSibling = script.indexOf('try{$c=$w.GetNextSibling($c)}catch{$c=$null}');
    expect(nodeTry).toBeGreaterThanOrEqual(0);
    expect(faultRecord).toBeGreaterThan(nodeTry);
    expect(addNode).toBeGreaterThan(faultRecord);
    expect(recurse).toBeGreaterThan(addNode);
    expect(nextSibling).toBeGreaterThan(recurse);
  });

  it('returns selector uniqueness and live target safety metadata while preserving first-match writes', async () => {
    const read = await windowsUiaRead(fixtureWorkspace(), 42, { automation_id: 'RibbonMainWindow.startTeamTestAction', control_type: 'MenuItem' });
    expect(read.data).toMatchObject({
      match_count: 1,
      automation_id: 'RibbonMainWindow.startTeamTestAction',
      control_type: 'MenuItem',
      enabled: true,
      offscreen: false,
      bounds_finite: true,
      bounds_empty: false,
      bounds: { x: -1804, y: 81, width: 36, height: 20 }
    });
    const readScript = scripts.at(-1)!;
    expect(readScript).toContain('function findUiaElements(');
    expect(readScript).toContain('$matches=findUiaElements 42');
    expect(readScript).toContain('match_count=$matches.Count');
    expect(readScript).toContain('enabled=$e.Current.IsEnabled');
    expect(readScript).toContain('offscreen=$e.Current.IsOffscreen');
    expect(readScript).toContain('bounds=$b.bounds');
    expect(readScript).toContain('bounds_finite=$b.bounds_finite');
    expect(readScript).toContain('bounds_empty=$b.bounds_empty');

    await windowsUiaSetValue(fixtureWorkspace(), 42, { automation_id: 'target' }, 'value');
    const writeScript = scripts.at(-1)!;
    expect(writeScript).toContain('function findUiaElement(');
    expect(writeScript).toContain('return $matches[0]');
    expect(writeScript).toContain('$e=findUiaElement 42');
  });

  it('places the verified foreground-hwnd guard before click cursor or mouse emission', async () => {
    await windowsWindowClick(fixtureWorkspace(), 42, 10, 20, 'left', 'client', true);
    const script = scripts[0];
    const guard = script.indexOf('$focused=ensureWindowInputFocus 42 $true');
    const cursor = script.indexOf('[System.Windows.Forms.Cursor]::Position=', guard);
    const clickCall = script.indexOf("click 'left'", cursor);
    expect(script).toContain('$focus=[Win32Windows]::Focus([IntPtr]$hwnd)');
    expect(script).toContain('([long]$focus.foreground_hwnd -ne [long]$hwnd)');
    expect(guard).toBeGreaterThanOrEqual(0);
    expect(cursor).toBeGreaterThan(guard);
    expect(clickCall).toBeGreaterThan(cursor);
    const coordinateBlock = script.slice(script.indexOf('public class Win32WindowCoordinates'), script.indexOf('function windowPoint'));
    expect(coordinateBlock).not.toContain('SetForegroundWindow(hWnd)');
  });

  it('guards both emissions of a focus-required window double click', async () => {
    await windowsWindowDoubleClick(fixtureWorkspace(), 42, 10, 20, 'left', 'client', true);
    expect(scripts).toHaveLength(2);
    for (const script of scripts) {
      const guard = script.indexOf('$focused=ensureWindowInputFocus 42 $true');
      const cursor = script.indexOf('[System.Windows.Forms.Cursor]::Position=', guard);
      expect(guard).toBeGreaterThanOrEqual(0);
      expect(cursor).toBeGreaterThan(guard);
    }
  });

  it('retains explicit non-focusing behavior when focus=false', async () => {
    await windowsWindowDoubleClick(fixtureWorkspace(), 42, 10, 20, 'left', 'client', false);
    expect(scripts).toHaveLength(2);
    for (const script of scripts) {
      expect(script).toContain('$focused=ensureWindowInputFocus 42 $false');
      const guardStart = script.indexOf('function ensureWindowInputFocus');
      const guardInvocation = script.indexOf('$focused=ensureWindowInputFocus 42 $false');
      const guardBody = script.slice(guardStart, guardInvocation);
      expect(guardStart).toBeGreaterThanOrEqual(0);
      expect(guardInvocation).toBeGreaterThan(guardStart);
      expect(guardBody).toContain('if(-not [bool]$focusRequested){ return $false }');
      expect(guardBody.indexOf('return $false')).toBeLessThan(guardBody.indexOf('[Win32Windows]::Focus'));
    }
  });

  it('uses the same verified pre-input guard for focused move, drag, and scroll paths', async () => {
    await windowsWindowMouseMove(fixtureWorkspace(), 42, 10, 20, 'client', true);
    await windowsWindowDrag(fixtureWorkspace(), 42, 10, 20, 30, 40, 'client', true, 100, 4);
    await windowsWindowScroll(fixtureWorkspace(), 42, 10, 20, 120, 'client', true);
    expect(scripts).toHaveLength(3);
    for (const script of scripts) {
      const guard = script.indexOf('$focused=ensureWindowInputFocus 42 $true');
      const cursorOrDrag = Math.max(script.indexOf('[System.Windows.Forms.Cursor]::Position=', guard), script.indexOf('$d=drag ', guard));
      expect(guard).toBeGreaterThanOrEqual(0);
      expect(cursorOrDrag).toBeGreaterThan(guard);
    }
  });
});

function fixtureWorkspace(): Workspace {
  return {
    id: 'windows-safety',
    name: 'Windows Safety',
    root: '/tmp/windows-safety',
    realRoot: '/tmp/windows-safety',
    realAgentDir: '/tmp/windows-safety/.agent',
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
      allow_screenshot: false,
      allow_uia_tree: true,
      allow_mouse: true,
      allow_keyboard: true,
      allow_clipboard: false,
      allow_window_management: true,
      allow_app_launch: false,
      allow_process_attach: false,
      allow_multi_monitor: true
    }
  };
}
