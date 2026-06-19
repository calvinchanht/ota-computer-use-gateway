# Brokered executor stack

Issue #33 introduces an optional broker/control-plane for local/private executor workers. The safe shape is:

```text
CustomGPT / Webchat Action
  -> public brokered executor job API
  -> private/local executor worker claims outbound
  -> worker calls localhost/private OTA executor
  -> structured result and broker-owned artifact contract
```

## Default-off requirement

The brokered executor stack is disabled by default:

```yaml
brokered_executors:
  enabled: false
```

When the block is absent, config parsing defaults it to disabled. Existing agents should expose no new Action paths and should behave exactly as before. Mickey may use an explicit fake-executor config as the testbed, but that is an opt-in config, not a global default.

## Agent and executor isolation

Each executor must be explicitly configured:

```yaml
brokered_executors:
  enabled: true
  executors:
    - executor_id: mickey-fake-windows
      executor_kind: windows_computer_use
      agent_id: mickey
      enabled: true
      allowed_operations:
        - windows.status
        - windows.list_monitors
        - windows.list_windows
        - windows.screenshot
      worker_bearer_token_env: MICKEY_FAKE_EXECUTOR_TOKEN
```

The broker checks that submitted jobs target the owning `agent_id` and that `operation_name` is explicitly allowlisted for the executor. Enabling Anna's Windows executor must not enable anything for Boba, Catalyst, Genesis, or Mickey unless their own configs opt in.

## V1 operations

V1 is read-only:

```text
windows.status
windows.list_monitors
windows.list_windows
windows.screenshot
```

Mutating operations such as click, keyboard typing, clipboard writes, and app launch are intentionally out of scope for V1.

## HTTP paths

When enabled, requester routes are:

```text
POST /ota/api/v1/executor-jobs
GET  /ota/api/v1/executor-jobs/{broker_job_id}
GET  /ota/api/v1/executor-jobs/{broker_job_id}/result
```

Worker routes are:

```text
POST /ota/api/v1/executors/{executor_id}/heartbeat
POST /ota/api/v1/executors/{executor_id}/claim
POST /ota/api/v1/executors/{executor_id}/jobs/{broker_job_id}/complete
POST /ota/api/v1/executors/{executor_id}/jobs/{broker_job_id}/fail
```

When disabled, brokered executor routes return `brokered_executors_disabled` and generated default Action schemas do not include these paths.

## Worker auth

Requester access uses the normal OTA HTTP bearer/auth boundary. Executor worker routes can require an additional per-executor bearer token by setting `worker_bearer_token_env`. When present, heartbeat/claim/complete/fail require `Authorization: Bearer <token from env>`, scoped to that executor id.

## Contract version handshake

Executor workers heartbeat with a contract version and supported operations:

```json
{
  "executor_id": "mickey-fake-windows",
  "executor_kind": "windows_computer_use",
  "contract_version": "brokered-executor-v1",
  "supported_operations": [
    "windows.status",
    "windows.list_monitors",
    "windows.list_windows",
    "windows.screenshot"
  ]
}
```

This prevents Mickey and Windows-side adapters from silently drifting while they develop in parallel.

## Current implementation slice

The initial Mickey/testbed slice is intentionally in-memory and not a production queue. It proves:

- default-off config;
- per-agent and per-operation isolation;
- submit/status/result routes;
- heartbeat/claim/complete/fail worker routes;
- idempotent submit;
- one-job claim semantics;
- lease ownership on completion;
- fake Windows read-only adapter results/artifacts;
- default Action schemas do not expose broker routes.

Before production use, the remaining hardening includes persistent storage, persistent storage, broker-owned artifact signing/exposure, deployment-specific Mickey opt-in config, and WindowsPC-Genesis integration for the real Anna Windows adapter.
