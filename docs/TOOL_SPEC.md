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
