# ota-computer-use-gateway

Provider-neutral local computer-use gateway for OTA/web-thread agents, exposed through MCP-style tools.

Status: early MVP scaffold. The first target is the Genesis VPS, with Linux and macOS support planned from the start and Windows kept as a future platform.

## Transports

The gateway supports two MCP transport modes:

- stdio, for OpenAI Secure MCP Tunnel and local harnesses;
- HTTP Streamable MCP at `/mcp`, for public HTTPS ingress such as Cloudflare Tunnel, Tailscale Funnel, or ngrok.

Examples:

```bash
node dist/index.js --config config/mickey.local.yaml
node dist/index.js --config config/mickey.local.yaml --transport http
```

The HTTP mode also exposes `GET /healthz` for local/tunnel health checks with safe readiness metadata only: service, transport, MCP path, uptime, auth-required, rate-limit-enabled, and max request bytes. Requests with `Content-Length` above `security.max_request_bytes` are rejected before reaching MCP handling, `/mcp` requests are rate-limited by `server.rate_limit`, and safe HTTP metadata is appended to `.agent/audit/http_requests.jsonl`. Proxy client IP headers are ignored unless `server.rate_limit.trust_proxy_headers` is explicitly enabled. `SIGINT`/`SIGTERM` close the HTTP listener and MCP transport cleanly.

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

See GitHub issue #1 for the source-of-truth implementation plan.

## Primitive runtime

The gateway exposes explicit snake_case MCP primitives for agent runtime work:

- discovery and policy: `heartbeat`, `workspace_status`, `get_workspace_policy`, `get_tool_profile`
- browser/computer-use foundation: scoped CDP proxy tools (`list_browser_profiles`, `browser_status`, `list_browser_tabs`, `browser_cdp_browser_call`, `browser_cdp_browser_batch`, `browser_cdp_call`, `browser_cdp_batch`) and scoped Cua Driver proxy tools (`cua_driver_status`, `cua_driver_call`, `cua_driver_batch`)
- filesystem: `list_dir`, `stat_path`, `tree`, `read_file`, `write_file`, `read_binary_file`, `write_binary_file`, `edit_file`, `search_files`
- patches: `propose_patch`, `apply_patch`
- commands: `run_command`, `run_configured_command`
- processes: `start_process`, `list_processes`, `read_process`, `write_process`, `stop_process`
- skills/runbooks: `list_skills`, `read_skill`

`exec` and old `process_*` names exist only as deprecated compatibility aliases. Use `get_tool_profile` for machine-readable canonical names and aliases.

See `docs/PRIMITIVE_RUNTIME.md` for the runtime surface, safety model, and validation gate.
See `docs/CONTEXT_PICKUP.md` for the chat-thread bootstrap/checkpoint model used by issue #4 and the Mickey provider-thread proof used by issue #11.
See `docs/SKILLS.md` for the progressive skill/runbook discovery model used by issue #5.
See `docs/COMPUTER_USE.md` for the observe/act and `observe_after` foundation used by issue #6.
See `docs/CATALYST_ADAPTER.md` for the Catalyst adapter MVP plan and setup template used by issue #7.
See `docs/CATALYST_CONNECTOR.md` for the Catalyst provider connector setup handoff.
See `docs/CATALYST_PUBLIC_INGRESS.md` for the Catalyst public HTTPS ingress relay and recovery notes.
See `docs/SIMILAR_PROJECT_SCAN.md` for adjacent GitHub project patterns we should borrow or avoid.

## Mickey provider-thread proof

Mickey is the first proof workspace for OpenClaw-like provider chat-thread agents.
A fresh provider thread should be able to call `get_agent_bootstrap`, read the `mickey-pickup` skill, inspect policy/tool/browser posture, and write a continuity checkpoint through the public MCP connector.

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
