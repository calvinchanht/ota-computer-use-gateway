import { describeManagedProcess, getManagedProcess, killManagedProcess, listManagedProcesses, managedProcessOutput, startManagedProcess, writeManagedProcess } from '../core/processManager.js';
import { ok } from '../core/result.js';
import type { AppConfig } from '../config/schema.js';
import type { Workspace } from '../core/workspaces.js';

const MAX_LOG_BYTES = 50000;

export async function processStart(config: AppConfig, workspace: Workspace, command: string) {
  if (!workspace.allow_tests) throw new Error('workspace does not allow command execution');
  const item = startManagedProcess(command, workspace.realRoot, config.security.max_exec_ms);
  return ok('process started', describeManagedProcess(item));
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
