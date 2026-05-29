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
  const child = spawn(invocation.command, invocation.args, { cwd, env: safeEnv() });
  const item = newProcess(command, cwd, child);
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
  return truncateText(merged, MAX_BUFFER_BYTES).text;
}

function safeEnv(): NodeJS.ProcessEnv {
  const keep = ['PATH', 'HOME', 'LANG', 'LC_ALL', 'SHELL'];
  return Object.fromEntries(keep.map((key) => [key, process.env[key] ?? '']));
}
