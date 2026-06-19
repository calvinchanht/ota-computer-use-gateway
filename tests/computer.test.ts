import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Workspace } from '../src/core/workspaces.js';
import { computerWindowClick, computerWindowDrag, computerWindowMouseMove, computerWindowScroll, cuaDriverBatch, cuaDriverCall, cuaDriverStatus, screenshotVisualFollowup } from '../src/tools/computer.js';

describe('cua driver proxy tools', () => {

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.THREADEX_VISUAL_FOLLOWUP_BASE_URL;
    delete process.env.THREADEX_VISUAL_FOLLOWUP_PUBLIC_BASE_URL;
    delete process.env.THREADEX_VISUAL_FOLLOWUP_BEARER_TOKEN;
    delete process.env.THREADEX_JOB_API_BEARER_TOKEN;
  });

  it('returns an instruction when screenshot visual follow-up has no job id', async () => {
    const result = await screenshotVisualFollowup({ preview: { readable_url: 'https://boba-api.unrealize.com/api/v1/artifacts/screen.webp?sig=abc' } });
    expect(result).toMatchObject({ state: 'not_requested', sent_to_provider: false, provider_visible: false, reason: 'threaddex_job_id_required' });
    expect(String((result as any).instruction)).toContain('params.visual_followup.job_id');
  });

  it('creates a Threaddex visual follow-up and returns a pollable public status URL', async () => {
    process.env.THREADEX_VISUAL_FOLLOWUP_BASE_URL = 'http://127.0.0.1:33988';
    process.env.THREADEX_VISUAL_FOLLOWUP_PUBLIC_BASE_URL = 'https://threaddex-boba.unrealize.com';
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({
        ok: true,
        visual_followup: {
          id: 'vf-1',
          idempotency_key: 'vf-1',
          state: 'pending',
          delivery: 'pending',
          sent_to_provider: false,
          provider_visible: false,
          status_path: '/v1/job/job_123/visual-followup/vf-1/status',
          status_url: 'http://127.0.0.1:33988/v1/job/job_123/visual-followup/vf-1/status',
          poll_after_ms: 1000
        }
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    });

    const result = await screenshotVisualFollowup(
      { artifact: { preview: { readable_url: 'https://boba-api.unrealize.com/api/v1/artifacts/screen.webp?sig=abc' } } },
      { visual_followup: { job_id: 'job_123', idempotency_key: 'vf-1' } }
    ) as any;

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://127.0.0.1:33988/v1/job/job_123/visual-followup');
    expect(JSON.parse(String(calls[0].init.body))).toMatchObject({ idempotency_key: 'vf-1', kind: 'screenshot', source: 'cua_driver', readable_url: 'https://boba-api.unrealize.com/api/v1/artifacts/screen.webp?sig=abc' });
    expect(JSON.parse(String(calls[0].init.body)).prompt_text).toBe('Parse this job image NOW: https://boba-api.unrealize.com/api/v1/artifacts/screen.webp?sig=abc');
    expect(result).toMatchObject({ id: 'vf-1', state: 'pending', sent_to_provider: false, provider_visible: false, readable_url: 'https://boba-api.unrealize.com/api/v1/artifacts/screen.webp?sig=abc' });
    expect(result.status_url).toBe('https://threaddex-boba.unrealize.com/v1/job/job_123/visual-followup/vf-1/status');
    expect(result.instruction).toContain('Poll visual_followup.status_url');
  });

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

  it('explains that raw native mouse commands require pid and point to high-level screen/window tools', async () => {
    await expect(cuaDriverCall(fixtureWorkspace({ allow_mouse_keyboard: true }), 'click', { x: 720, y: 450 })).rejects.toThrow('Use computer_screen_* for global screen coordinates');
    await expect(cuaDriverCall(fixtureWorkspace({ allow_mouse_keyboard: true }), 'right_click', { x: 720, y: 450 })).rejects.toThrow('native Cua window/process mouse command');
    await expect(cuaDriverCall(fixtureWorkspace({ allow_mouse_keyboard: true }), 'drag', { from_x: 10, from_y: 10, to_x: 20, to_y: 20 })).rejects.toThrow('native Cua window/process mouse command');
    await expect(cuaDriverCall(fixtureWorkspace({ allow_mouse_keyboard: true }), 'scroll', { direction: 'down' })).rejects.toThrow('native Cua window/process mouse command');
  });

  it('requires pid for explicit window mouse controls', async () => {
    const workspace = fixtureWorkspace({ allow_mouse_keyboard: true });
    await expect(computerWindowClick(workspace, Number.NaN, 720, 450)).rejects.toThrow('computer_window_click requires pid');
    await expect(computerWindowMouseMove(workspace, Number.NaN, 720, 450)).rejects.toThrow('computer_window_mouse_move requires pid');
    await expect(computerWindowDrag(workspace, Number.NaN, 10, 10, 20, 20)).rejects.toThrow('computer_window_drag requires pid');
    await expect(computerWindowScroll(workspace, Number.NaN, 'down')).rejects.toThrow('computer_window_scroll requires pid');
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
