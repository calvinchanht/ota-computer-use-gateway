import { describeManagedProcess, getManagedProcess, killManagedProcess, listManagedProcesses, managedProcessOutput, startManagedArgvProcess, startManagedProcess, writeManagedProcess } from '../core/processManager.js';
import { ok } from '../core/result.js';
import { resolveInside } from '../core/paths.js';
import { assertNoJobLifecycleCommand, commandTextFromArgv } from './jobLifecycleGuard.js';
import type { AppConfig } from '../config/schema.js';
import type { Workspace } from '../core/workspaces.js';

const MAX_LOG_BYTES = 50000;

export async function processStart(config: AppConfig, workspace: Workspace, command: string) {
  if (!workspace.allow_tests) throw new Error('workspace does not allow command execution');
  assertNoJobLifecycleCommand(command);
  const item = startManagedProcess(command, workspace.realRoot, config.security.max_exec_ms);
  return ok('process started', describeManagedProcess(item));
}

export async function processStartArgv(config: AppConfig, workspace: Workspace, cmd: string[], cwdPath = '.', timeoutMs = 30000) {
  if (!workspace.allow_tests) throw new Error('workspace does not allow command execution');
  if (!Array.isArray(cmd) || cmd.length === 0) throw new Error('cmd_array must be an array');
  const [command, ...args] = cmd.map(String);
  assertNoJobLifecycleCommand(commandTextFromArgv([command, ...args]));
  const cwd = await resolveInside(workspace, cwdPath, config);
  const timeout = Math.min(Math.max(1, timeoutMs), config.security.max_exec_ms);
  const item = startManagedArgvProcess(command, args, cwd.absolute, timeout, cmd.join(' '));
  return ok('process started', { ...describeManagedProcess(item), command_argv: cmd, cwd: cwd.relative, timeout_ms: timeout, tail_supported: true, read_with: 'read_process', initial_cursor: 0 });
}

export function processList() {
  return ok('process list', { processes: listManagedProcesses().map(describeManagedProcess) });
}

export function processLog(processId: string, maxBytes = MAX_LOG_BYTES, cursor?: number) {
  const item = getManagedProcess(processId);
  const output = managedProcessOutput(item, cursor, Math.min(maxBytes, MAX_LOG_BYTES));
  return ok('process log', { ...describeManagedProcess(item), ...output, tail_supported: true });
}

export function processKill(processId: string) {
  const killed = killManagedProcess(processId);
  return ok(killed ? 'process killed' : 'process already exited', { process_id: processId, killed });
}

export function processWrite(processId: string, input: string, closeStdin = false) {
  if (Buffer.byteLength(input, 'utf8') > MAX_LOG_BYTES) throw new Error('input exceeds max process write bytes');
  const bytes = writeManagedProcess(processId, input, closeStdin);
  return ok('process input written', { process_id: processId, bytes, closed_stdin: closeStdin });
}
