import { spawn } from 'node:child_process';

export type CommandResult = { code: number | null; stdout: string; stderr: string };

export async function runCommand(cmd: string, args: string[], cwd: string, timeoutMs = 10000, env: NodeJS.ProcessEnv = {}): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, env: { ...safeEnv(), ...env } });
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (data) => stdout += data);
    child.stderr.on('data', (data) => stderr += data);
    child.on('error', reject);
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}

function safeEnv(): NodeJS.ProcessEnv {
  const keep = ['PATH', 'HOME', 'LANG', 'LC_ALL', 'SHELL'];
  return Object.fromEntries(keep.map((key) => [key, process.env[key] ?? '']));
}
