import { spawn } from 'node:child_process';
import { childProcessEnvironment } from './processEnvironment.js';
import type { ChildEnvironmentMode } from './securityPolicy.js';

export type CommandResult = { code: number | null; stdout: string; stderr: string; timed_out: boolean };

export async function runCommand(cmd: string, args: string[], cwd: string, timeoutMs = 10000, env: NodeJS.ProcessEnv = {}, environmentMode: ChildEnvironmentMode = 'minimal'): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, env: childProcessEnvironment(environmentMode, env), windowsHide: true });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (data) => stdout += data);
    child.stderr.on('data', (data) => stderr += data);
    child.on('error', reject);
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr, timed_out: timedOut }); });
  });
}
