# Primitive Runtime

The Tool Gateway exposes provider-neutral MCP primitives for chat-thread agents. The public surface uses explicit snake_case names so tools are clear in MCP clients and ChatGPT-style action pickers.

Canonical naming profile:

```text
mcp_explicit
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
- `edit_file` — replace exactly one matching text region.
- `search_files` — search text in workspace files.

All filesystem tools resolve paths inside the configured workspace root. Symlink escapes and denied globs are rejected.

## Patch primitives

- `propose_patch` — store an exact-text patch proposal without modifying files.
- `apply_patch` — apply exact-text replacements after local approval.

Keep `edit_file` and `apply_patch` separate:

- `edit_file` is for one surgical replacement in one file.
- `apply_patch` is for structured multi-change edits.

## Command primitives

- `run_command` — run an approved shell command in the workspace root.
- `run_configured_command` — run a configured command id after approval.

`run_command` is the canonical raw shell primitive. `exec` exists only as a deprecated OpenClaw-compatible alias.

## Managed process primitives

- `start_process` — start an approved background shell command.
- `list_processes` — list managed background processes.
- `read_process` — read buffered stdout/stderr for a process.
- `write_process` — write UTF-8 input to process stdin, optionally closing stdin.
- `stop_process` — terminate a managed process.

Deprecated compatibility aliases remain during migration:

```text
process_start -> start_process
process_list  -> list_processes
process_log   -> read_process
process_kill  -> stop_process
```

## Tool annotations

Tools include MCP annotations where possible:

- read-only tools set `readOnlyHint: true` and `destructiveHint: false`.
- file mutation, patch, command, approval, and process-control tools are marked non-read-only and destructive.
- all current primitives set `openWorldHint: false` because they operate against configured local workspaces rather than arbitrary public internet resources.

Clients should still enforce their own policy; annotations are hints, not security boundaries.

## Approval and safety model

Write, patch, command, and process-start primitives require workspace capability flags and local approval where configured by the tool. Safety comes from layered controls:

- workspace-bound path resolution;
- symlink escape rejection;
- denied glob checks;
- bounded file/request/response/process output sizes;
- bearer auth for public HTTP ingress;
- rate limiting and safe HTTP audit logs;
- explicit approval records for dangerous actions.

## Validation

Use the primitive smoke test before considering runtime changes healthy:

```bash
npm run smoke:primitives
```

The smoke test launches a temporary local HTTP MCP gateway and exercises discovery, filesystem, command, and process primitives end to end.

For the full local gate, run:

```bash
npm test
npm run build
npm run smoke:primitives
```

To check a deployed public HTTPS MCP endpoint, set the endpoint and bearer token outside git:

```bash
export OTA_GATEWAY_SMOKE_URL="https://mickey-mcp.example.com/mcp"
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
