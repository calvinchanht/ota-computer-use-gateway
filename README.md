# ota-computer-use-gateway

Provider-neutral local computer-use gateway for OTA/web-thread agents, exposed through MCP-style tools.

Status: active production capability gateway used by multiple Threaddex/webchat agents. Linux, macOS/Cua Driver, and Windows native computer-use lanes are implemented; capability exposure is policy-driven per workspace through composable `api_sets` (`workspace`, `browser`, `computer`, `computer_windows`, `machine_admin`, `estate_admin`).

## Transports

The gateway supports two MCP transport modes:

- stdio, for OpenAI Secure MCP Tunnel and local harnesses;
- HTTP Streamable MCP at `/mcp`, for public HTTPS ingress such as Cloudflare Tunnel, Tailscale Funnel, or ngrok.

Examples:

```bash
node dist/index.js --config config/mickey.local.yaml
node dist/index.js --config config/mickey.local.yaml --transport http
```

HTTP defaults to stateful Streamable HTTP sessions. Set `OTA_MCP_TRANSPORT_MODE=stateless` for disposable per-request MCP transports that emit no `mcp-session-id`; durable workspace, run, browser, and process state remains outside the MCP transport. MCP clients should send `Accept: application/json, text/event-stream`. Stateful clients reuse the returned session header, while stateless clients reconnect for each request. `GET /healthz` reports the active MCP transport mode alongside safe readiness metadata. Requests with `Content-Length` above `security.max_request_bytes` are rejected before MCP handling, `/mcp` requests are rate-limited by `server.rate_limit`, and safe HTTP metadata is appended to `.agent/audit/http_requests.jsonl`. Proxy client IP headers are ignored unless `server.rate_limit.trust_proxy_headers` is explicitly enabled. `SIGINT`/`SIGTERM` close the HTTP listener and MCP transport cleanly.

For public HTTPS ingress, enable bearer auth and set the token only in the process environment. HTTP mode refuses to bind a non-loopback host without auth enabled:

```yaml
server:
  auth:
    enabled: true
    bearer_token_env: "OTA_GATEWAY_BEARER_TOKEN"
```

```bash
export OTA_GATEWAY_BEARER_TOKEN="use-a-long-random-secret"
```

The HTTP server also exposes the JSON tool API used by Threaddex facades and machine integrations: `/api/v1/tool`, `/api/v1/batch`, and `/api/v1/runs/{run_id}`. For a normal Threaddex webchat agent, the canonical provider app is the combined root `https://<agent>-mcp.unrealize.com/` surface served by WPO/Threaddex; it composes native lifecycle tools with the OTA tools assigned to that workspace. Direct `https://<agent-api-host>/ota/mcp` remains an OTA-only compatibility/debug connector and should not replace the combined provider app for a job-managed agent.

When HTTP auth is enabled, use bearer authorization and keep the token in protected runtime configuration. Auth applies on loopback too unless `allow_loopback_without_auth: true` is explicitly configured. A non-loopback HTTP bind is refused when auth is disabled.

Historical issue #1 records the initial scaffold plan; current behavior is defined by the implementation, capability/security docs, tests, and live host configs.

## Primitive runtime

The gateway exposes explicit snake_case primitives according to the selected workspace's capability sets. The exact surface is discoverable through `get_tool_profile` and `get_workspace_policy`; do not maintain a second hand-written allowlist in provider instructions.

Major groups include:

- discovery/policy: `heartbeat`, `workspace_status`, `get_workspace_policy`, `get_tool_profile`;
- workspace: inventory, scoped file read/write/edit/delete, structured data helpers, patches, git/GitHub, artifacts, memory/continuity, skills, bounded commands, and managed processes;
- browser: profile/status/tab helpers plus scoped raw CDP calls/batches;
- macOS/local computer: Cua Driver screenshots, accessibility/window state, mouse/keyboard, and local app control;
- Windows computer: monitor/window/screenshot/UIA/mouse/keyboard/clipboard/app-launch tools, gated by `computer_windows` or explicit Windows rights;
- machine admin: configured commands and server-approved workspace helpers plus host-scoped filesystem access when `filesystem.machine_admin_host_scope` is enabled;
- estate admin: cross-host/agent estate diagnostics and approved control-plane operations.

`exec` and old `process_*` names exist only as deprecated compatibility aliases. Use the discovery tools for canonical names, aliases, capability notes, and async/quota-saver behavior.

See `docs/PRIMITIVE_RUNTIME.md` for the runtime surface, safety model, and validation gate.
See `docs/CONTEXT_PICKUP.md` for the chat-thread bootstrap/checkpoint model used by issue #4 and the Mickey provider-thread proof used by issue #11.
See `docs/SKILLS.md` for the progressive skill/runbook discovery model used by issue #5.
See `docs/COMPUTER_USE.md` for the observe/act and `observe_after` foundation used by issue #6.
See `docs/CATALYST_ADAPTER.md` for the Catalyst adapter MVP plan and setup template used by issue #7.
See `docs/CATALYST_CONNECTOR.md` for the Catalyst provider connector setup handoff.
See `docs/CATALYST_PUBLIC_INGRESS.md` for the Catalyst public HTTPS ingress relay and recovery notes.
See `docs/SIMILAR_PROJECT_SCAN.md` for adjacent GitHub project patterns we should borrow or avoid.
See `docs/OTA_MEMORY.md` for the optional server-owned OTA-Memory lifecycle-v1 adapter and M14 fixture-handle contract.

## Mickey provider-thread proof

Mickey was the original provider-thread proof workspace and remains a useful canary. It is no longer the only deployment target. A fresh provider thread should be able to call `get_agent_bootstrap`, read the `mickey-pickup` skill, inspect policy/tool/browser posture, and write a continuity checkpoint through its configured provider surface.

Key Mickey startup artifacts live under `.agent/`:

- `.agent/AGENT_START_HERE.md`
- `.agent/PROVIDER_THREAD_PROMPT.md`
- `.agent/MICKEY_PROVIDER_ACCEPTANCE.md`
- `.agent/skills/mickey-pickup/SKILL.md`

Focused live/public validation:

```bash
export OTA_GATEWAY_SMOKE_URL="https://mickey-api.example.com/api/v1/tool"
export OTA_GATEWAY_SMOKE_TOKEN="..."
npm run smoke:mickey-acceptance
```

With explicit checkpoint-write opt-in:

```bash
export OTA_GATEWAY_ACCEPTANCE_WRITE=1
npm run smoke:mickey-acceptance
```

Validation:

```bash
npm test
npm run build
npm run smoke:primitives
```

## Mickey / provider runtime

- [Mickey no-App bridge](docs/MICKEY_NO_APP_BRIDGE.md) — ChatGPT Project as source shell + scoped Gateway JSON API runtime.

## Agent host path split

For single-host Custom GPT Action setup, keep a strict service boundary on the same public agent hostname:

- `/ota/...` is the OTA capability gateway for workspace, file, command, browser, computer, memory, artifact, approval, and estate tools.
- `/threaddex/...` is the native Threaddex Job API for job read, progress, final delivery, schedules, agent messages, and thread anchors.

Do not expose or document `threaddex_*` job proxy tools from OTA. The old proxy code was a temporary bridge and is intentionally removed from the Mickey testbed first.

