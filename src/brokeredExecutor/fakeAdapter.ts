import { createHash } from 'node:crypto';
import type { ExecutorResult } from './types.js';

export const FAKE_WINDOWS_EXECUTOR_ID = 'mickey-fake-windows';
export const FAKE_WINDOWS_EXECUTOR_KIND = 'windows_computer_use';
export const FAKE_WINDOWS_OPERATIONS = ['windows.status', 'windows.list_monitors', 'windows.list_windows', 'windows.screenshot'];

const ONE_PIXEL_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=', 'base64');

export async function runFakeWindowsOperation(operationName: string, args: Record<string, unknown> = {}): Promise<ExecutorResult> {
  const started = new Date().toISOString();
  if (!FAKE_WINDOWS_OPERATIONS.includes(operationName)) return failed('operation_not_allowed', `unsupported fake windows operation: ${operationName}`, started);
  if (operationName === 'windows.status') return succeeded({ host_supported: true, adapter: 'fake-windows-testbed', capabilities: { read_only: true } }, [], started);
  if (operationName === 'windows.list_monitors') return succeeded({ monitors: [{ monitor_id: 'primary', bounds: { x: 0, y: 0, width: 1024, height: 768 }, primary: true }] }, [], started);
  if (operationName === 'windows.list_windows') return succeeded({ windows: [{ title: 'Fake Desktop', hwnd: 100, bounds: { x: 0, y: 0, width: 1024, height: 768 } }] }, [], started);
  const monitorId = typeof args.monitor_id === 'string' ? args.monitor_id : typeof args.monitor === 'string' ? args.monitor : 'primary';
  if (!['primary', '0'].includes(monitorId)) return failed('monitor_not_found', `fake monitor not found: ${monitorId}`, started);
  const sha256 = createHash('sha256').update(ONE_PIXEL_PNG).digest('hex');
  return succeeded({ monitor_id: monitorId, bounds: { x: 0, y: 0, width: 1, height: 1 } }, [{ kind: 'image', mime_type: 'image/png', sha256, bytes: ONE_PIXEL_PNG.length, artifact_path: '.agent/artifacts/fake-windows-screenshot.png' }], started);
}

function succeeded(result: Record<string, unknown>, artifacts: ExecutorResult['artifacts'], startedAt: string): ExecutorResult {
  return { status: 'succeeded', result, artifacts, audit: { policy_decision: 'allowed', started_at: startedAt, finished_at: new Date().toISOString() } };
}

function failed(error_code: NonNullable<ExecutorResult['error_code']>, error_message: string, startedAt: string): ExecutorResult {
  return { status: 'failed', result: {}, artifacts: [], error_code, error_message, audit: { policy_decision: error_code === 'operation_not_allowed' ? 'denied' : 'allowed', started_at: startedAt, finished_at: new Date().toISOString() } };
}
