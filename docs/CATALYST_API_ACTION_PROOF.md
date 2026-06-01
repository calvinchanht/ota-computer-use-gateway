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

## First successful custom GPT proof

A private/live GPT named `Catalyst API Smoke` was created with this OpenAPI Action schema.

Chat URL observed during proof:

```text
https://chatgpt.com/g/g-6a1ceac0f6cc8191afb535a5b6bea0ab-catalyst-api-smoke/c/6a1ceba8-af1c-832f-899a-4eda62457eed
```

ChatGPT showed the expected domain confirmation:

```text
Catalyst API Smoke wants to talk to catalyst-mcp.unrealize.com
Tool call: catalyst_mcp_unrealize_com__jit_plugin.gateway_request
Confirm / Deny
```

After confirmation, the GPT reported:

```text
Success. Read/write/read-back smoke test completed.

Initial read: .agent/smoke/api-action-branch-smoke.txt returned catalyst api branch smoke 2026-06-01.
Write confirmed: .agent/smoke/private-gpt-chat-write.txt.
Read-back confirmed exact content: private custom GPT Catalyst write at 2026-06-01.
```

Genesis independently verified the written file through the public Catalyst Gateway JSON API:

```json
{
  "ok": true,
  "summary": "read .agent/smoke/private-gpt-chat-write.txt",
  "data": {
    "text": "private custom GPT Catalyst write at 2026-06-01"
  },
  "api": {
    "transport": "http-json",
    "tool": "read_file",
    "status": "completed"
  }
}
```

## Batch, recovery, and continuity API smoke

The OpenAPI Action schema was expanded to include:

- `gateway_request` -> `POST /api/v1/tool`
- `gateway_batch` -> `POST /api/v1/batch`
- `get_gateway_run` -> `GET /api/v1/runs/{run_id}`

The Catalyst public JSON API was then smoke-tested with a batch containing:

1. `workspace_status`
2. `write_file` to `.agent/smoke/api-action-batch-test.txt`
3. `read_file` of `.agent/smoke/api-action-batch-test.txt`
4. `checkpoint_thread`

Result:

```text
ok: true
summary: completed 4 API batch steps
run_id: 87c4ffd8-ff27-4562-80ee-7c7d1e5f7996
status: completed
```

Recovery lookup also succeeded through:

```text
GET /api/v1/runs/87c4ffd8-ff27-4562-80ee-7c7d1e5f7996
```

Returned:

```text
ok: true
kind: batch
status: completed
summary: completed 4 API batch steps
```

## GPT schema update and chat-level batch/recovery proof

The private `Catalyst API Smoke` GPT Action schema was updated to v0.2. The Action table then showed:

- `gateway_request` -> `POST /api/v1/tool`
- `gateway_batch` -> `POST /api/v1/batch`
- `get_gateway_run` -> `GET /api/v1/runs/{run_id}`

A new GPT chat called `gateway_batch` with four steps:

1. `workspace_status`
2. `write_file` to `.agent/smoke/private-gpt-batch-write.txt`
3. `read_file` of `.agent/smoke/private-gpt-batch-write.txt`
4. `checkpoint_thread`

ChatGPT displayed the expected confirmation gate for `gateway_batch`, then returned:

```text
api.run_id: cf9e4715-ed03-4b64-b649-871c92ea4079

Success: Catalyst gateway_batch completed 4 steps. Workspace status succeeded, file write succeeded, read-back confirmed the content exactly:

private Catalyst GPT batch write at 2026-06-01

Checkpoint recorded with title Catalyst GPT batch proof.
```

Genesis independently verified the batch-written file through public Catalyst JSON API:

```text
read .agent/smoke/private-gpt-batch-write.txt
private Catalyst GPT batch write at 2026-06-01
```

Genesis also independently verified the GPT batch run record:

```text
run_id: cf9e4715-ed03-4b64-b649-871c92ea4079
kind: batch
status: completed
summary: completed 4 API batch steps
```

The GPT then called `get_gateway_run` for the same run ID. ChatGPT offered `Allow`, `Always allow`, and `Decline`; `Always allow` was selected. The GPT returned:

```text
Kind: batch
Status: completed
Summary: completed 4 API batch steps
Batch had 4 steps: yes.
```

A follow-up `get_gateway_run` call in the same chat executed without another confirmation prompt and returned status completed, confirming that `Always allow` reduces repeated confirmation for this GPT/domain/action context.

## Remaining proof work

The Catalyst custom GPT is now workable for direct scoped API use. Remaining hardening before making it the main Catalyst shell:

1. Decide whether `Catalyst API Smoke` should be renamed/promoted into the main Catalyst custom GPT.
2. Consider adding lower-scope action-specific bearer tokens instead of long-term main Catalyst bearer use.
3. Add richer but still minimal tool schemas only as needed.
4. Decide whether/when to merge `api-action-catalyst-proof` back to `main`.
