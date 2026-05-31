# Proposed Mickey Gateway API Interface

Preferred action name: `gateway_request`.

Request shape:

```json
{
  "thread": {
    "provider": "chatgpt",
    "project_id": "mickey",
    "thread_id": "provider-thread-id-if-available-or-client-session-id",
    "message_id": "optional"
  },
  "tool": "workspace_status",
  "arguments": {},
  "idempotency_key": "optional"
}
```

Batch shape:

```json
{
  "thread": {
    "provider": "chatgpt",
    "project_id": "mickey",
    "thread_id": "provider-thread-id-if-available-or-client-session-id"
  },
  "steps": [
    { "tool": "workspace_status", "arguments": {} },
    { "tool": "read_file", "arguments": { "path": ".agent/AGENT_START_HERE.md" } }
  ],
  "idempotency_key": "optional"
}
```

Run recovery:

Every successful `/api/v1/tool` or `/api/v1/batch` response includes:

```json
{
  "api": {
    "transport": "http-json",
    "run_id": "uuid",
    "status": "completed"
  }
}
```

If a provider stream fails after a tool call, recover the result with:

```http
GET /api/v1/runs/{run_id}
```

Use `idempotency_key` on retries. Repeating the same key returns the original run result instead of creating a duplicate run.

Expected server behavior:

- API key fixes workspace to Mickey.
- API key fixes allowed tools.
- `workspace_id` should not be accepted from the model for cross-workspace access.
- Every call is audited with redacted args/result summaries.
- Every call gets a retrievable run record.
- Large/private outputs return summaries plus artifact ids.
- Mutating calls require idempotency keys.
- Bridge/orchestrator continuity tools may call `checkpoint_thread` and `memory_write` for durable pickup after important Project-chat/API turns.
