const JOB_LIFECYCLE_ENDPOINT = /\/(?:threaddex\/)?v1\/(?:agents\/[^\s'";|&<>]+\/)?job(?:\/[^\s'";|&<>?]*)*(?:(?:\/(?:progress|deliver|continuation))|(?:[?&][^\s'";|&<>]*\bjob_id=)|(?:\/job_[^\s'";|&<>?]+(?:\/(?:progress|deliver|continuation))?))/i;
const NETWORK_LIFECYCLE_CLIENT = /(?:^|[\s;&|])(?:curl|wget|http|https|httpie)(?:\s|$)/i;
const CODE_LIFECYCLE_CLIENT = /(?:fetch\s*\(|requests\s*\.|urllib\.|Net::HTTP|axios\s*\.|http\.request\s*\(|https\.request\s*\()/i;
const CODE_RUNNER = /(?:^|[\s;&|/])(?:node|python3?|ruby|perl|php)(?:\s|$)/i;
const INERT_SEARCH_COMMAND = /(?:^|[\s;&|])(?:grep|rg|ag)(?:\s|$)/i;
const GITHUB_BODY_FILE_FLOW = /(?:^|\s)gh\s+issue\s+(?:create|comment|edit)\b[\s\S]*\s--body-file(?:\s|=)/i;
const HEREDOC_START = /<<-?\s*['"]?([A-Za-z_][A-Za-z0-9_]*)['"]?/;
const CAT_WRITE_HEREDOC = /(?:^|[\s;&|])cat\s*>/i;

export const JOB_LIFECYCLE_COMMAND_TIP = 'Tip: this command appears to mention or call Threaddex job lifecycle endpoints. If it is performing job retrieval, progress, final delivery, or continuation, use the native /threaddex Action operations getJob, deliverJobProgress, deliverJob, or requestJobContinuation instead of tunneling lifecycle through /ota run_command.';

export function jobLifecycleCommandWarnings(commandText: string): string[] {
  if (!JOB_LIFECYCLE_ENDPOINT.test(commandText)) return [];
  if (!isExecutableLifecycleCommand(commandText)) return [];
  return [JOB_LIFECYCLE_COMMAND_TIP];
}

export function commandTextFromArgv(cmd: string[]): string {
  return cmd.map((part) => String(part)).join(' ');
}

function isExecutableLifecycleCommand(commandText: string): boolean {
  const executableText = lifecycleExecutableText(commandText);
  if (!JOB_LIFECYCLE_ENDPOINT.test(executableText)) return false;
  if (GITHUB_BODY_FILE_FLOW.test(executableText)) return false;
  if (INERT_SEARCH_COMMAND.test(executableText) && !NETWORK_LIFECYCLE_CLIENT.test(executableText) && !CODE_LIFECYCLE_CLIENT.test(executableText)) return false;
  if (NETWORK_LIFECYCLE_CLIENT.test(executableText)) return true;
  if (CODE_LIFECYCLE_CLIENT.test(executableText)) return true;
  if (CODE_RUNNER.test(executableText) && JOB_LIFECYCLE_ENDPOINT.test(executableText)) return true;
  return false;
}

function lifecycleExecutableText(commandText: string): string {
  if (!HEREDOC_START.test(commandText)) return commandText;
  if (CAT_WRITE_HEREDOC.test(commandText) || GITHUB_BODY_FILE_FLOW.test(commandText)) return stripHereDocBodies(commandText);
  return commandText;
}

function stripHereDocBodies(commandText: string): string {
  const lines = commandText.split(/\r?\n/);
  const kept: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    kept.push(line);
    const marker = HEREDOC_START.exec(line)?.[1];
    if (!marker) continue;
    for (index += 1; index < lines.length && lines[index] !== marker; index += 1) undefined;
    if (index < lines.length) kept.push(lines[index]);
  }
  return kept.join('\n');
}
