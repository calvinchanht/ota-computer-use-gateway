const JOB_LIFECYCLE_ENDPOINT = /\/(?:threaddex\/)?v1\/(?:agents\/[^\s'\";|&<>]+\/)?job\/?(?:\?|\/[^\s'\";|&<>]*(?:\/(?:progress|deliver|continuation)|[?&]job_id=)|[?][^\s'\";|&<>]*\bjob_id=)/i;

export function assertNoJobLifecycleCommand(commandText: string): void {
  if (!JOB_LIFECYCLE_ENDPOINT.test(commandText)) return;
  throw new Error('blocked_job_lifecycle_via_run_command: use native Threaddex Job API Action operations getJob, deliverJobProgress, deliverJob, or requestJobContinuation; do not call job lifecycle endpoints through run_command/bash/curl');
}

export function commandTextFromArgv(cmd: string[]): string {
  return cmd.map((part) => String(part)).join(' ');
}
