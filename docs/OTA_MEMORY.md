# OTA-Memory lifecycle integration

OTA can expose three flat provider-facing lifecycle tools when a workspace explicitly enables `ota_memory`:

- `memory_begin_turn`
- `memory_commit_turn`
- `memory_flush_session`

The returned `data` is the complete lifecycle-v1 receipt and retains the canonical dotted operation name (`memory.begin_turn`, `memory.commit_turn`, or `memory.flush_session`). Semantic `unavailable`, `in_progress`, replay, no-op, and partial statuses are not replaced with unrelated fallback behavior.

## Workspace configuration

```yaml
workspaces:
  - id: anna
    name: Anna
    root: D:/Projects/Anna
    ota_memory:
      enabled: true
      python_executable: python
      package_root: D:/Projects/Anna/deployments/ota-memory-candidate
      database_path: D:/Projects/Anna/runtime/ota-memory/anna.sqlite3
      project_id: anna
      workspace_id: anna
      agent_id: anna
      user_id: calvin
      scope_type: project
      privacy: project_only
      fixture_handles_file: D:/Projects/Anna/runtime/ota-memory/m14-handles.json
      timeout_ms: 30000
```

When `server.exposed_tools` is non-empty, include the three tool names there as well.

`package_root`, `database_path`, identity, project scope, and privacy are server-owned. They are deliberately absent from model tool schemas. OTA starts the Python adapter without a shell and sends its internal request over stdin, so candidate content does not appear in command arguments.

## Opaque M14 fixture handles

An optional server-owned handle store may map opaque execution handles to isolated databases and scopes:

```json
{
  "handles": {
    "m14-fixture-opaque-1": {
      "database_path": "D:/Projects/Anna/runtime/ota-memory/m14/fixture-1.sqlite3",
      "project_id": "m14-fixture-1",
      "workspace_id": "anna",
      "agent_id": "anna",
      "user_id": "calvin",
      "scope_type": "project",
      "privacy": "project_only",
      "expires_at": "2026-07-23T00:00:00Z"
    }
  }
}
```

The model may supply only `execution_handle`. Unknown, expired, unavailable, or malformed stores fail explicitly without returning server paths.

## Activation gate

Keep the current live memory deployment unchanged while staging the adapter. Before activation, prove:

1. rollover/resumption;
2. irrelevant no-memory control;
3. unavailable-memory recovery.

Run OTA-Memory validation and `npm run check` for OTA gateway before changing a live deployment pointer.
