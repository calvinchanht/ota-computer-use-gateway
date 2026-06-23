import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { shellInvocation } from './commandAdapter.js';
import { truncateText } from './text.js';
import type { CommandRuntime } from './commandAdapter.js';

export type ManagedProcess = {
  id: string;
  command: string;
  cwd: string;
  started_at: string;
  exit_code: number | null;
  killed: boolean;
  child: ChildProcessWithoutNullStreams;
  stdout: string;
  stderr: string;
  spawn_error?: string;
  spawn_error_code?: string;
};

const processes = new Map<string, ManagedProcess>();
const MAX_BUFFER_BYTES = 100000;

export function startManagedProcess(command: string, cwd: string, timeoutMs: number, runtime?: CommandRuntime): ManagedProcess {
  const invocation = shellInvocation(command, undefined, runtime);
  return startManagedArgvProcess(invocation.command, invocation.args, cwd, timeoutMs, command);
}

export function startManagedArgvProcess(command: string, args: string[], cwd: string, timeoutMs: number, displayCommand?: string): ManagedProcess {
  const child = spawn(command, args, { cwd, env: safeEnv(), detached: process.platform !== 'win32' });
  const item = newProcess(displayCommand ?? [command, ...args].join(' '), cwd, child);
  processes.set(item.id, item);
  attachOutput(item);
  attachError(item);
  attachClose(item);
  setTimeout(() => killManagedProcess(item.id), timeoutMs).unref();
  return item;
}

export function listManagedProcesses(): ManagedProcess[] {
  return [...processes.values()];
}

export function getManagedProcess(id: string): ManagedProcess {
  const item = processes.get(id);
  if (!item) throw new Error(`unknown process id: ${id}`);
  return item;
}

export function killManagedProcess(id: string, signal: NodeJS.Signals = 'SIGTERM'): boolean {
  const item = getManagedProcess(id);
  if (item.exit_code !== null) return false;
  item.killed = true;
  return signalManagedProcess(item, signal);
}

export function terminateManagedProcesses(signal: NodeJS.Signals = 'SIGTERM'): number {
  let signaled = 0;
  for (const item of processes.values()) {
    if (item.exit_code !== null) continue;
    item.killed = true;
    if (signalManagedProcess(item, signal)) signaled++;
  }
  return signaled;
}

export function hasRunningManagedProcesses(): boolean {
  return [...processes.values()].some((item) => item.exit_code === null);
}

export async function shutdownManagedProcesses(graceMs = 1500): Promise<{ signaled: number; forced: number }> {
  const signaled = terminateManagedProcesses('SIGTERM');
  await waitForManagedProcessesToExit(graceMs);
  if (!hasRunningManagedProcesses()) return { signaled, forced: 0 };
  let forced = 0;
  for (const item of processes.values()) {
    if (item.exit_code !== null) continue;
    item.killed = true;
    if (signalManagedProcess(item, 'SIGKILL')) forced++;
  }
  await waitForManagedProcessesToExit(1000);
  return { signaled, forced };
}

async function waitForManagedProcessesToExit(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + Math.max(0, timeoutMs);
  while (hasRunningManagedProcesses() && Date.now() < deadline) await delay(10);
}

export function writeManagedProcess(id: string, input: string, closeStdin = false): number {
  const item = getManagedProcess(id);
  if (item.exit_code !== null) throw new Error('process already exited');
  item.child.stdin.write(input);
  if (closeStdin) item.child.stdin.end();
  return Buffer.byteLength(input, 'utf8');
}

export function describeManagedProcess(item: ManagedProcess) {
  return {
    process_id: item.id,
    command: item.command,
    cwd: item.cwd,
    started_at: item.started_at,
    running: item.exit_code === null && !item.killed,
    stopping: item.exit_code === null && item.killed,
    exit_code: item.exit_code,
    killed: item.killed,
    spawn_error: item.spawn_error,
    spawn_error_code: item.spawn_error_code
  };
}

export function managedProcessOutput(item: ManagedProcess, cursor?: number, maxBytes = MAX_BUFFER_BYTES): { output: string; next_cursor: number; cursor: number; truncated: boolean; cursor_clamped: boolean } {
  const combined = item.stdout + item.stderr;
  const requestedCursor = cursor === undefined ? 0 : Math.trunc(cursor);
  const boundedCursor = Math.min(Math.max(requestedCursor, 0), combined.length);
  const output = truncateText(combined.slice(boundedCursor), Math.min(Math.max(Math.trunc(maxBytes), 1), MAX_BUFFER_BYTES));
  return { output: output.text, next_cursor: combined.length, cursor: boundedCursor, truncated: output.truncated, cursor_clamped: requestedCursor !== boundedCursor };
}


function signalManagedProcess(item: ManagedProcess, signal: NodeJS.Signals): boolean {
  const pid = item.child.pid;
  if (!pid) return false;
  if (process.platform === 'win32') {
    const result = spawnSync('taskkill.exe', ['/pid', String(pid), '/t', '/f'], { windowsHide: true });
    if (!result.error) return true;
  }
  try {
    // Managed tools run in their own process group so shells and their descendants are cleaned together.
    process.kill(-pid, signal);
    return true;
  } catch {
    try { return item.child.kill(signal); }
    catch { return false; }
  }
}

function newProcess(command: string, cwd: string, child: ChildProcessWithoutNullStreams): ManagedProcess {
  return { id: `proc_${randomUUID()}`, command, cwd, started_at: new Date().toISOString(), exit_code: null, killed: false, child, stdout: '', stderr: '' };
}

function attachOutput(item: ManagedProcess): void {
  item.child.stdout.on('data', (data) => item.stdout = appendBounded(item.stdout, data));
  item.child.stderr.on('data', (data) => item.stderr = appendBounded(item.stderr, data));
}

function attachClose(item: ManagedProcess): void {
  item.child.on('close', (code) => {
    if (item.exit_code === null) item.exit_code = code;
  });
}

function attachError(item: ManagedProcess): void {
  item.child.on('error', (error: NodeJS.ErrnoException) => {
    item.spawn_error = error.message;
    item.spawn_error_code = error.code;
    item.stderr = appendBounded(item.stderr, Buffer.from(`spawn_error: ${error.message}\n`));
    if (item.exit_code === null) item.exit_code = -1;
  });
}

function appendBounded(existing: string, data: Buffer): string {
  const merged = existing + data.toString('utf8');
  const buffer = Buffer.from(merged, 'utf8');
  if (buffer.length <= MAX_BUFFER_BYTES) return merged;
  return buffer.subarray(buffer.length - MAX_BUFFER_BYTES).toString('utf8');
}

function safeEnv(): NodeJS.ProcessEnv {
  const keep = ['PATH', 'Path', 'HOME', 'USERPROFILE', 'TEMP', 'TMP', 'LANG', 'LC_ALL', 'SHELL', 'COMSPEC', 'SystemRoot', 'WINDIR'];
  return Object.fromEntries(keep.map((key) => [key, process.env[key] ?? '']));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
