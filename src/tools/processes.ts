import { requireApproval } from './approval.js';
import { getManagedProcess, killManagedProcess, listManagedProcesses, startManagedProcess } from '../core/processManager.js';
import { ok } from '../core/result.js';
import { truncateText } from '../core/text.js';
import type { AppConfig } from '../config/schema.js';
import type { Workspace } from '../core/workspaces.js';

const MAX_LOG_BYTES = 50000;

export async function processStart(config: AppConfig, workspace: Workspace, command: string, approvalAction = 'process_start') {
  if (!workspace.allow_tests) throw new Error('workspace does not allow command execution');
  await requireApproval(workspace, approvalAction);
  const item = startManagedProcess(command, workspace.realRoot, config.security.max_exec_ms);
  return ok('process started', describeProcess(item));
}

export function processList() {
  return ok('process list', { processes: listManagedProcesses().map(describeProcess) });
}

export function processLog(processId: string, maxBytes = MAX_LOG_BYTES) {
  const item = getManagedProcess(processId);
  const output = truncateText(item.stdout + item.stderr, Math.min(maxBytes, MAX_LOG_BYTES));
  return ok('process log', { ...describeProcess(item), output: output.text, truncated: output.truncated });
}

export function processKill(processId: string) {
  const killed = killManagedProcess(processId);
  return ok(killed ? 'process killed' : 'process already exited', { process_id: processId, killed });
}

function describeProcess(item: ReturnType<typeof getManagedProcess>) {
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
