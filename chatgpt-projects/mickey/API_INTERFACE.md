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

Expected server behavior:

- API key fixes workspace to Mickey.
- API key fixes allowed tools.
- `workspace_id` should not be accepted from the model for cross-workspace access.
- Every call is audited with redacted args/result summaries.
- Large/private outputs return summaries plus artifact ids.
- Mutating calls require idempotency keys.
