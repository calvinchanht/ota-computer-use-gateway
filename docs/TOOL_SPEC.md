# Tool Spec

OTA's tool surface is policy-generated rather than a fixed MVP list. `get_tool_profile` and `get_workspace_policy` are the machine-readable source of truth for the selected workspace; provider instructions should not maintain a second hand-written allowlist.

## Core discovery

Every workspace exposes the basic discovery/policy surface needed to understand its boundary:

- `heartbeat`
- `workspace_status`
- `get_workspace_policy`
- `get_tool_profile`

Additional tools are enabled by the resolved workspace capability sets and legacy `allow_*` compatibility fields.

## Capability groups

### Workspace

Depending on read/write/patch/exec policy, the workspace set includes:

- inventory, file and structured-data reads;
- file write/edit/delete and table/JSON mutation helpers;
- patch proposal/application;
- git status/diff/publish plus authenticated Git/GitHub operation lanes;
- artifacts, memory, continuity/checkpoint, context and skill tools;
- bounded argv commands and managed processes;
- async/quota-saver run recovery through `/api/v1/runs/{run_id}`.

Scoped mutation is not deferred. When policy grants write/patch/exec capability, those tools are real operational primitives. Server policy currently does not impose a generic approval list (`requires_approval: []`); a provider UI may still ask for confirmation based on its own risk model. Tool-specific gates still apply where implemented—for example `apply_patch` requires its local approval action before it performs the exact-text replacement.

### Browser

The browser set includes profile/status/tab/visible-state helpers and scoped raw Chrome DevTools Protocol calls/batches. Browser access is tied to the configured profiles/ports for the workspace.

### Computer

The `computer` set uses Cua Driver for local GUI work such as screenshots, windows/accessibility state, mouse/keyboard input and local application control.

### Windows computer

`computer_windows` is implemented. The full macro enables the native Windows monitor/window/screenshot/UIA/mouse/keyboard/clipboard/app-launch surface; narrower lanes can enable `windows_computer` with individual rights.

### Machine admin

`machine_admin` enables own-host/lane operations such as configured commands and server-approved workspace helpers. When `filesystem.machine_admin_host_scope` is enabled, the existing file tools may use explicit absolute paths inside `filesystem.host_root`; relative paths remain rooted in the configured workspace.

### Estate admin

`estate_admin` adds the explicitly registered cross-host/cross-agent estate diagnostic and runbook-oriented operations. Network reachability alone never grants estate authority.

## Command and process contract

`run_command` is argv-first. Use `cmd_array` with executable and arguments as separate values. Legacy shell-string compatibility exists only on older/explicit surfaces and should not be the provider-facing contract for new tools.

Long-running work should use `run_command(tail=true)` or `start_process`, then consume deltas with `read_process(cursor)`. Managed commands run in their own process group so `stop_process` and gateway shutdown can terminate descendants rather than leaving orphan shell trees.

`exec` and old `process_*` names are deprecated compatibility aliases. Prefer the names returned by `get_tool_profile`.

## File/path contract

- Workspace-relative paths stay inside the configured workspace root; relative `..` traversal is rejected.
- Reads re-check containment after `realpath`/symlink resolution.
- Writable paths resolve the nearest existing ancestor and final parent through `realpath`; an existing target is also resolved before the write boundary is accepted.
- Machine-admin host scope is available only for explicit absolute paths when the workspace has both machine-admin policy and host-scope filesystem configuration.

See `SECURITY.md` and `POLICY_MODEL.md` for the full containment and authority rules.

## Provider annotations

Default `server.tool_annotations.mode: honest` advertises actual risk rather than pretending all local tools are read-only:

- reads: read-only, non-destructive, closed-world;
- mutating file tools: non-read-only, destructive, closed-world;
- command/process-style local execution: non-read-only, destructive, open-world.

`private_high_autonomy` can suppress the provider destructive confirmation hint for trusted private write/run lanes, but it never changes the underlying authorization or falsely marks mutations read-only.

## Panic and audit

`.agent/PANIC_STOP` remains an operator stop mechanism for tools covered by the panic policy. Tool calls and HTTP request metadata are written to bounded audit streams with secret/token redaction. See `AUDIT_RETENTION.md` for retention and export rules.
