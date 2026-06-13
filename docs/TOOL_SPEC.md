# Tool Spec

MVP tools:

- `heartbeat`
- `get_workspace_policy`
- `list_dir`
- `read_file`
- `search_files`
- `git_status`
- `git_diff`
- `memory_search`
- `memory_write`
- `get_project_context`
- `propose_patch`

Mutation tools are deferred until policy, audit, and approval are proven.


## Implemented behavior notes

- `apply_patch` performs exact-text replacement only after local approval.
- `run_command` only runs configured command IDs, never arbitrary shell text from the client.
- Command execution is routed through a platform adapter so Linux/macOS and future Windows support stay isolated.
- Workspace tools write audit records under `.agent/audit/tool_calls.jsonl`.
- `.agent/PANIC_STOP` blocks non-low-risk workspace tools.

## Process tailing

`read_process` supports cursor-based tailing. Clients can pass `cursor` from a prior `next_cursor` value to receive only newly buffered process output. This is the preferred workflow for long-running test/build/watch commands when live progress matters.

## Cursor tail and lifecycle notes

`read_process` and `browser_tail` are cursor-tail APIs. Clients should pass `cursor` from the prior `next_cursor` to retrieve only new output/visible-state deltas.

For long-running commands, prefer `run_command` with `tail=true` or `start_process`, followed by `read_process(cursor)`. Normal `run_command` remains for short commands.

Managed process tools start commands in their own process group. `stop_process` and API shutdown target the process group to avoid leaving shell descendants behind. API services should not be restarted through their own API request path; use an external supervisor lane.
