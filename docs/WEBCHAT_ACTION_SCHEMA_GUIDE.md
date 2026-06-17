# Webchat Action schema guide

Use compact OpenAPI schemas for ChatGPT Custom GPT Actions.

## Recommended shape

Expose one Action with three operations:

- `gateway_request` -> `POST /api/v1/tool`
- `gateway_batch` -> `POST /api/v1/batch`
- `get_gateway_run` -> `GET /api/v1/runs/{run_id}`

Keep operation arguments generic:

```yaml
arguments:
  type: object
  additionalProperties: true
  required: [workspace_id]
  properties:
    workspace_id:
      type: string
      enum: [<workspace_id>]
```

This is more reliable in the GPT editor than exhaustive per-operation argument schemas.

## Operation enum

Use `operation` as the canonical public field inside `gateway_request` and each `gateway_batch` step. Legacy `tool` is still accepted by the gateway for compatibility, but new Custom GPT schemas should prefer `operation`.

Include only the operations exposed by that lane. The enum helps the GPT pick the right operation name while the generic `arguments` object keeps the schema small.

Examples:

- workspace-only: file/context/git/checkpoint/run_command/process tools.
- workspace+browser: workspace tools plus browser profiles/tabs/CDP helpers.
- computer/Cua: workspace tools plus Cua status/call/batch.
- Genesis control-plane: read-heavy estate/control-plane report tools.

## Description limits

Keep operation descriptions short. The GPT editor has practical limits and can reject long descriptions. Put detailed instructions in GPT instructions and repo docs, not inside every operation description.

## Auth

Use API Key / Bearer. Token values belong only in the private GPT Action auth field.

## Async contract

Mention the recovery contract in the schema and GPT instructions:

- `api.status` / `api.operation_status`
- `api.run_id` / `api.operation_id`
- `api.poll_after_ms` / `api.next_poll_after_ms`
- `GET /api/v1/runs/{run_id}`

The agent must poll runs instead of retrying the original non-idempotent action.
