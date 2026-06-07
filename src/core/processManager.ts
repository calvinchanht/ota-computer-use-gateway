import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { shellInvocation } from './commandAdapter.js';
import { truncateText } from './text.js';

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
};

const processes = new Map<string, ManagedProcess>();
const MAX_BUFFER_BYTES = 100000;

export function startManagedProcess(command: string, cwd: string, timeoutMs: number): ManagedProcess {
  const invocation = shellInvocation(command);
  return startManagedArgvProcess(invocation.command, invocation.args, cwd, timeoutMs, command);
}

export function startManagedArgvProcess(command: string, args: string[], cwd: string, timeoutMs: number, displayCommand?: string): ManagedProcess {
  const child = spawn(command, args, { cwd, env: safeEnv() });
  const item = newProcess(displayCommand ?? [command, ...args].join(' '), cwd, child);
  processes.set(item.id, item);
  attachOutput(item);
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

export function killManagedProcess(id: string): boolean {
  const item = getManagedProcess(id);
  if (item.exit_code !== null) return false;
  item.killed = true;
  return item.child.kill('SIGTERM');
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
    running: item.exit_code === null,
    exit_code: item.exit_code,
    killed: item.killed
  };
}

export function managedProcessOutput(item: ManagedProcess, cursor?: number, maxBytes = MAX_BUFFER_BYTES): { output: string; next_cursor: number; cursor: number; truncated: boolean } {
  const combined = item.stdout + item.stderr;
  const boundedCursor = cursor === undefined ? 0 : Math.min(Math.max(Math.trunc(cursor), 0), combined.length);
  const output = truncateText(combined.slice(boundedCursor), Math.min(Math.max(Math.trunc(maxBytes), 1), MAX_BUFFER_BYTES));
  return { output: output.text, next_cursor: combined.length, cursor: boundedCursor, truncated: output.truncated };
}

function newProcess(command: string, cwd: string, child: ChildProcessWithoutNullStreams): ManagedProcess {
  return { id: `proc_${randomUUID()}`, command, cwd, started_at: new Date().toISOString(), exit_code: null, killed: false, child, stdout: '', stderr: '' };
}

function attachOutput(item: ManagedProcess): void {
  item.child.stdout.on('data', (data) => item.stdout = appendBounded(item.stdout, data));
  item.child.stderr.on('data', (data) => item.stderr = appendBounded(item.stderr, data));
}

function attachClose(item: ManagedProcess): void {
  item.child.on('close', (code) => { item.exit_code = code; });
}

function appendBounded(existing: string, data: Buffer): string {
  const merged = existing + data.toString('utf8');
  const buffer = Buffer.from(merged, 'utf8');
  if (buffer.length <= MAX_BUFFER_BYTES) return merged;
  return buffer.subarray(buffer.length - MAX_BUFFER_BYTES).toString('utf8');
}

function safeEnv(): NodeJS.ProcessEnv {
  const keep = ['PATH', 'HOME', 'LANG', 'LC_ALL', 'SHELL'];
  return Object.fromEntries(keep.map((key) => [key, process.env[key] ?? '']));
}
