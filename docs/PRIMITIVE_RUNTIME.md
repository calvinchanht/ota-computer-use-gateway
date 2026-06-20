# Primitive Runtime

The Tool Gateway exposes provider-neutral API primitives for chat-thread agents. The public surface uses explicit snake_case names so tools are clear in API clients and ChatGPT-style action pickers.

Canonical naming profile:

```text
api_explicit
```

Use `get_tool_profile` at runtime to discover canonical tools, compatibility aliases, deprecated names, and context conventions.

## Workspace discovery

- `heartbeat` — report local gateway availability.
- `workspace_status` — list configured workspaces, capabilities, and command ids.
- `get_workspace_policy` — return allowed tools and approval requirements for one workspace.
- `get_tool_profile` — return the canonical naming profile, aliases, and context conventions.

## Filesystem primitives

- `list_dir` — list entries in a workspace directory.
- `stat_path` — return metadata for a workspace path.
- `tree` — return a bounded recursive directory tree.
- `read_file` — read a bounded UTF-8 text range.
- `write_file` — create or overwrite a UTF-8 file.
- `read_binary_file` — read a bounded binary file as base64 with metadata.
- `write_binary_file` — create or overwrite a bounded binary file from base64 content.
- `edit_file` — replace exactly one matching text region.
- `search_files` — search text in workspace files.

All filesystem tools resolve paths inside the configured workspace root, or inside `filesystem.host_root` for machine-admin host-scope absolute paths. Symlink escapes are rejected because they cross the configured scope. There is no hidden path, secret, credential, or glob deny layer; adding one requires Calvin's explicit approval.

Path contract:

- Prefer workspace-relative paths.
- Absolute paths are accepted only when they resolve under the configured workspace root.
- `..` escapes and symlink escapes are rejected with workspace-relative guidance.
- If an agent is unsure where it is operating, call `workspace_status` or `workspace_inventory` before touching paths.

Keep text and binary tools separate:

- use `read_file` / `write_file` for UTF-8 text;
- use `read_binary_file` / `write_binary_file` for images, PDFs, zips, screenshots, and other binary artifacts.

Text payload contract:

- `write_file.content`, `edit_file.old_text`, and `edit_file.new_text` are strings.
- Empty `write_file.content` and empty `edit_file.new_text` are valid; `edit_file.old_text` must be non-empty.
- For JSON files, serialize the JSON exactly once and send that serialized text as `content`.
- Do not send raw objects or arrays in text fields. The gateway rejects them with a corrective diagnostic instead of guessing.
- For exact bytes or escaping-sensitive payloads, use `write_binary_file` with base64 rather than inventing a text encoding wrapper.

## Patch primitives

- `propose_patch` — store an exact-text patch proposal without modifying files.
- `apply_patch` — apply exact-text replacements after local approval.

Keep `edit_file` and `apply_patch` separate:

- `edit_file` is for one surgical replacement in one file.
- `apply_patch` is for structured multi-change edits.

Patch payload contract:

- `old_text` must be non-empty and must match exactly once.
- Non-unique matches are rejected; use a larger exact-text block instead of relying on first-match behavior.
- Not-found matches include a reminder to verify whitespace and line endings.
- Patches are intentionally strict. Do not fuzzy-apply or silently rewrite whole files to recover from stale context.

## Command primitives

- `run_command` — run a bounded argv command in the workspace root or a workspace-relative `cwd`.
- `run_configured_command` — run a configured command id after approval.

`run_command` prefers `cmd_array: string[]` at the HTTP JSON boundary. Legacy `cmd: string[]` is still accepted. Put the executable in `cmd_array[0]` and each argument in its own array entry. Do not send one shell-quoted command string. When shell behavior is intentional, call `get_tool_profile` or `get_workspace_policy` and use the advertised `command_runtime.recommended_cmd_array_for_shell`.

On Windows, configure PowerShell 7 explicitly rather than using Windows Terminal:

```yaml
command_runtime:
  preferred_shell: "powershell7"
  shell:
    command: "C:\\Program Files\\PowerShell\\7\\pwsh.exe"
    args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command"]
```

The configured shell applies to legacy shell-string surfaces such as MCP `run_command(command)`, `run_configured_command`, and `start_process(command)`. HTTP `run_command` remains argv-first.

Command result contract:

- Responses include `command`, `cwd`, `timeout_ms`, `timed_out`, `exit_code`, `stdout`, `stderr`, and truncation flags where applicable.
- JSON-looking arguments are passed as normal argv strings, not re-serialized by the gateway.
- For long-running work, prefer tail mode or `start_process` plus `read_process(cursor)` instead of retrying the original command.

`exec` exists only as a deprecated OpenClaw-compatible alias.

## Managed process primitives

- `start_process` — start an approved background command. Prefer `cmd_array: string[]`, matching `run_command`; legacy `command: string` shell mode remains supported for compatibility.
- `list_processes` — list managed background processes.
- `read_process` — read buffered stdout/stderr for a process. Pass `cursor` from the previous `next_cursor` to receive only new output.
- `write_process` — write UTF-8 input to process stdin, optionally closing stdin.
- `stop_process` — terminate a managed process.

For long-running commands where incremental output matters, prefer:

```text
start_process(cmd_array=[...]) -> read_process(cursor=previous next_cursor) -> stop_process if needed
```

This gives cursor-based tail behavior without retrying the original command. `read_process` returns `output`, `cursor`, `next_cursor`, `cursor_clamped`, `running`, `exit_code`, and `tail_supported`.

If a stale or out-of-range cursor is provided, the gateway clamps it to the current buffer and sets `cursor_clamped=true`. Treat this as a recoverable tail-position correction, not a reason to rerun the original command.

## Git primitives

- `github` — run GitHub CLI argv through the workspace configured PAT-backed lane. `cmd_array` starts after `gh`; for example `["issue", "view", "40", "-R", "owner/repo"]`.
- `git_status` — return concise git status.
- `git_diff` — return bounded git diff output.
- `git_push_current_branch` — push the current branch using configured server-side credentials.

`github` is raw GitHub CLI argv behind the OTA `github` operation, not raw shell. It never shell-interpolates the request. Configure `git.github_token_file` for the workspace; optionally configure `git.github_cli_wrapper` when the host has a canonical wrapper such as `/home/genesis/workspace/bin/gh-genesis`. Token values, tokenized remotes, and GitHub token patterns are redacted from output.

OTA does not maintain a GitHub operation allowlist. The `cmd_array` is forwarded to the configured `gh` adapter, and GitHub/PAT scopes decide what is permitted. Agents should call the OTA `github` operation instead of `run_command` with `gh`, `curl`, or ambient `GH_TOKEN`.

`get_tool_profile` and `get_workspace_policy` expose a non-secret GitHub status block:

```json
{
  "preferred_surface": "ota_github_operation",
  "auth_lane": "configured_token_file",
  "permission_model": "github_pat_scope",
  "adapter": "gh_cli",
  "raw_cli_via_run_command": "discouraged"
}
```

Git output contract:

- Tokenized remotes are sanitized before display.
- GitHub token-looking strings are redacted from command output.
- Token files and token values must never be returned to the caller.
- Wrong repo/ref/auth failures are Git lane diagnostics, not generic schema failures.
- Pre-push repo, remote, and auth setup failures throw classed diagnostics such as `git repo diagnostic`, `git remote diagnostic`, or `git auth diagnostic`.
- Push attempts return `status`, `failure_class`, `exit_code`, `timed_out`, and sanitized `output`. Known failure classes include `ref_mismatch`, `auth_or_repo`, `remote_unreachable`, `timeout`, and `git_push_failed`.

Deprecated compatibility aliases remain during migration:

```text
process_start -> start_process
process_list  -> list_processes
process_log   -> read_process
process_kill  -> stop_process
```

## Tool annotations

Tools include tool annotations where possible:

- read-only tools set `readOnlyHint: true` and `destructiveHint: false`.
- scoped workspace mutation, patch, local command, approval, and process-control tools are marked non-read-only but `destructiveHint: false`; they are local workspace operations, not provider-level destructive/external actions.
- all current primitives set `openWorldHint: false` because they operate against configured local workspaces rather than arbitrary public internet resources.

Clients should still enforce their own policy; annotations are hints, not security boundaries. The gateway intentionally avoids marking normal scoped workspace operations as destructive because some provider clients turn that hint into per-call human confirmation dialogs, which breaks the intended OpenClaw-like agent workflow.

## Approval and safety model

Write, patch, command, and process-start primitives require workspace capability flags and local approval where configured by the tool. Safety comes from layered controls:

- workspace-bound path resolution;
- symlink escape rejection;
- bounded file/request/response/process output sizes;
- bearer auth for public HTTP ingress;
- rate limiting and safe HTTP audit logs;
- explicit approval records for dangerous actions.

## Validation

Use the primitive smoke test before considering runtime changes healthy:

```bash
npm run smoke:primitives
```

The smoke test launches a temporary local HTTP API gateway and exercises discovery, filesystem, command, and process primitives end to end.

For the full local gate, run:

```bash
npm test
npm run build
npm run smoke:primitives
```

To check a deployed public HTTPS API endpoint, set the endpoint and bearer token outside git:

```bash
export OTA_GATEWAY_SMOKE_URL="https://mickey-api.example.com/api/v1/tool"
export OTA_GATEWAY_SMOKE_TOKEN="..."
npm run smoke:public
```

The public smoke is read-only by default. To also verify write/edit/command primitives against a controlled workspace, opt in explicitly:

```bash
export OTA_GATEWAY_SMOKE_WRITE=1
npm run smoke:public
```

## Deferred areas

These are intentionally outside issue #3 and tracked separately:

- workspace/context/continuity pickup — issue #4;
- skills/runbooks support — issue #5;
- browser/computer observe-act primitives — issue #6;
- deeper policy/approval/audit/redaction hardening — issue #9;
- ChatGPT connector/session ergonomics and richer output schemas — issue #10.

## Long-running command/browser observation discipline

Prefer cursor-tail tools for long-running work:

```text
run_command(tail=true) -> read_process(cursor=previous next_cursor)
start_process -> read_process(cursor=previous next_cursor)
browser_tail(cursor=previous next_cursor)
```

`run_command` without `tail=true` remains the compatibility path for short bounded commands. For tests/builds/watchers or browser observation, cursor-tail avoids blind polling and repeated full-state dumps.

Managed process lifecycle hardening:

- managed `start_process` and `run_command(tail=true)` commands launch in their own process group;
- `stop_process` and HTTP API shutdown signal the process group, not just the shell parent;
- shutdown escalates from `SIGTERM` to `SIGKILL` if children do not exit;
- after a kill request, API process records report `running=false` and `stopping=true` until the OS close event finalizes `exit_code`.

Service restart discipline:

- API services should use `KillMode=control-group`, `TimeoutStopSec=8`, and `SendSIGKILL=yes` so untracked descendants do not remain in the service cgroup.
- Do not restart an API service through a `run_command` currently executing inside that same service. The active request will be killed and in-memory run records can disappear. Use an external lane/service/shell for restarts.
- Browser processes launched through helpers that switch users, for example a `sudo -u molt` Chrome launch from a Genesis-owned service, may not be killable by the Genesis user service. Prefer launching long-lived browsers through their own service/user lane, or clean the exact browser profile explicitly.
