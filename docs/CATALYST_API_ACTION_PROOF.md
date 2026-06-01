# Catalyst API Action Proof

This branch validates Catalyst as the real provider-thread proof for the private custom GPT + OpenAPI Action model.

## Branch

```text
api-action-catalyst-proof
```

`main` remains the stable Mickey-proven API Action baseline. Catalyst-specific proof work lives here so experimental API Action artifacts are not homeless.

## Target lane

```text
Private Catalyst custom GPT
  -> OpenAPI Action gateway_request
  -> POST https://catalyst-mcp.unrealize.com/api/v1/tool
  -> Catalyst Gateway scoped workspace tools
```

This avoids the MCP App connector/tool-catalog path while keeping ChatGPT's native confirmation/privacy controls.

## Minimal API Action schema

Use:

```text
docs/examples/catalyst-api-action-openapi.yaml
```

The initial schema intentionally exposes only:

- `read_file`
- `write_file`

Both require:

```json
{ "workspace_id": "catalyst" }
```

## Deployed Catalyst state

Catalyst remote checkout was moved onto this branch and rebuilt:

```text
/home/molt/ota-computer-use-gateway
branch: api-action-catalyst-proof
service: catalyst-mcp-http.service
public base URL: https://catalyst-mcp.unrealize.com
```

Public JSON API smoke passed with bearer auth:

- `POST /api/v1/tool` `workspace_status` returned Catalyst workspace status.
- `POST /api/v1/tool` `write_file` wrote `.agent/smoke/api-action-branch-smoke.txt`.
- `POST /api/v1/tool` `read_file` read it back.

Verified read-back text:

```text
catalyst api branch smoke 2026-06-01
```

## Next custom GPT test

Create a private/invite-only custom GPT, tentatively named:

```text
Catalyst API Smoke
```

Configure:

- Action auth: API Key -> Bearer
- OpenAPI schema: `docs/examples/catalyst-api-action-openapi.yaml`
- Instructions: use `gateway_request` only for transparent Catalyst workspace proof calls; start with harmless read/write smoke.

Suggested first chat prompt:

```text
Use gateway_request to run this transparent Catalyst smoke test:
1. read_file {"workspace_id":"catalyst","path":".agent/smoke/api-action-branch-smoke.txt"}
2. write_file {"workspace_id":"catalyst","path":".agent/smoke/private-gpt-chat-write.txt","content":"private custom GPT Catalyst write at 2026-06-01","overwrite":true}
3. read_file {"workspace_id":"catalyst","path":".agent/smoke/private-gpt-chat-write.txt"}
Return a short success/failure summary.
```

## What counts as success

Catalyst proof is stronger than Mickey only after a real custom GPT chat:

1. Calls the Catalyst OpenAPI Action.
2. Handles or bypasses repeated confirmation via ChatGPT's privacy/always-allow setting.
3. Writes a harmless file in the Catalyst workspace.
4. Reads it back.
5. Genesis independently verifies the file through the public Catalyst Gateway JSON API.

After that, expand the action schema to include `gateway_batch`, `GET /api/v1/runs/{run_id}`, and scoped continuity tools.
