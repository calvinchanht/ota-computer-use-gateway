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
  -> POST https://catalyst-api.unrealize.com/api/v1/tool
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
public API base URL: https://catalyst-api.unrealize.com
compat MCP/public base URL: https://catalyst-mcp.unrealize.com
```

`catalyst-api.unrealize.com` is the preferred Custom GPT/OpenAPI Action hostname. `catalyst-mcp.unrealize.com` remains available for MCP compatibility to avoid breaking older connector paths.

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
Catalyst API Smoke wants to talk to catalyst-api.unrealize.com
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

## API hostname rename

To avoid confusing the real API Action lane with MCP, the Catalyst tunnel now has an API-specific hostname:

```text
https://catalyst-api.unrealize.com
```

Cloudflare routing and local ingress were updated so both hostnames route to the same Catalyst Gateway origin:

```text
catalyst-api.unrealize.com -> http://127.0.0.1:8767
catalyst-mcp.unrealize.com -> http://127.0.0.1:8767
```

The new API hostname was verified:

```text
POST https://catalyst-api.unrealize.com/api/v1/tool workspace_status
ok: true
summary: workspace status
run_id: 095e0cc1-e736-4ab8-a758-62dde98e8de8
```

The private `Catalyst API Smoke` GPT Action schema was updated to use `https://catalyst-api.unrealize.com`. A fresh GPT chat showed the cleaner confirmation text:

```text
Catalyst API Smoke wants to talk to catalyst-api.unrealize.com
```

After confirmation, GPT called the new domain successfully and reported:

```text
Talked to catalyst-api.unrealize.com
Domain/tool confirmation: http-json / workspace_status
Run status: completed
```

## Browser/CDP proxy API Action lane

The Catalyst JSON API now exposes the existing scoped browser/CDP proxy tools to the Custom GPT Action lane instead of wrapping them as high-level browser actions:

```text
list_browser_profiles
browser_status
list_browser_tabs
browser_cdp_browser_call
browser_cdp_browser_batch
browser_cdp_call
browser_cdp_batch
```

This keeps the intended architecture: Custom GPT -> Gateway JSON API -> scoped raw CDP proxy, with Gateway-provided auth, audit, request limits, run records, idempotency, and URL redaction defaults.

Browser/CDP JSON API calls default to `quota_saver` async behavior for ChatGPT/webchat friendliness: the gateway waits briefly for a result and returns immediately if ready; if the operation is still running, it returns `202` with `api.status="running"`, `api.run_id`, and `poll_after_ms=5000`. Clients should poll `GET /api/v1/runs/{run_id}` after `poll_after_ms` and must not retry the original browser command. Callers may pass `async_mode: "sync"`/`"off"` for old fully synchronous behavior when appropriate.

Public API smoke after deploy:

```text
browser_status -> ok true, run_id 87a060cd-e9cd-4baa-aca0-2434a9e8a917
list_browser_tabs -> ok true, listed 12 browser targets, run_id e35eaa9d-b4f8-430e-8ef4-10798c677b70
browser_cdp_browser_call Target.getTargets -> ok true, run_id b113c1d1-35aa-4327-9702-5da2b159449b
```

The private `Catalyst API Smoke` GPT Action schema was updated to v0.3. A fresh GPT chat successfully called:

```text
gateway_request browser_status {"workspace_id":"catalyst"}
Talked to catalyst-api.unrealize.com
api.run_id: e871b915-afbd-460d-ae28-95cf26f287d3
```

## Remaining proof work

The Catalyst custom GPT is now workable for direct scoped API use. Remaining hardening before making it the main Catalyst shell:

1. Decide whether `Catalyst API Smoke` should be renamed/promoted into the main Catalyst custom GPT.
2. Consider adding lower-scope action-specific bearer tokens instead of long-term main Catalyst bearer use.
3. Add richer but still minimal tool schemas only as needed.
4. Decide whether/when to merge `api-action-catalyst-proof` back to `main`.
