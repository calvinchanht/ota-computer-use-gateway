# Secure MCP Tunnel Setup

This project supports OpenAI Secure MCP Tunnel via stdio MCP and can also run a Streamable HTTP MCP endpoint for non-OpenAI public ingress such as Cloudflare Tunnel, Tailscale Funnel, or ngrok.

The preferred private path is still Secure MCP Tunnel when OpenAI Platform provisioning works. The HTTP mode keeps Mickey development moving while tunnel creation is blocked by account/org enablement.

## Current verified version

The latest public tunnel client checked during Mickey setup was:

- release: `v0.0.9--context-conduit-topaz`
- Linux amd64 asset: `tunnel-client-v0.0.9--context-conduit-topaz-linux-amd64.zip`
- expected SHA-256: `eab94825dbd589e938a6a7ba5cd74bf0becaa3bef0e655f4438a0f75fddfbc8f`

Prefer the latest release URL in runbooks rather than pinning this forever:

```text
https://github.com/openai/tunnel-client/releases/latest
```

## OpenAI prerequisites

Secure MCP Tunnel setup needs two OpenAI Platform values:

1. `CONTROL_PLANE_TUNNEL_ID`
   - Create or inspect it in Platform tunnel settings.
   - URL: `https://platform.openai.com/settings/organization/tunnels`
2. `CONTROL_PLANE_API_KEY`
   - Runtime API key used only by `tunnel-client doctor` and `tunnel-client run`.
   - The key principal needs Tunnels Read + Use for the tunnel.
   - Do not use an admin key for the long-running daemon.

If the ChatGPT connector UI cannot see the tunnel, verify the tunnel is associated with the target ChatGPT workspace and the connector operator has Tunnels Read + Use.

## Mickey local profile

Mickey's ignored local config is:

```text
config/mickey.local.yaml
```

The stdio command for Mickey is:

```bash
node /home/genesis/workspace/projects/ota-computer-use-gateway/dist/index.js \
  --config /home/genesis/workspace/projects/ota-computer-use-gateway/config/mickey.local.yaml
```

The HTTP command for Mickey is:

```bash
node /home/genesis/workspace/projects/ota-computer-use-gateway/dist/index.js \
  --config /home/genesis/workspace/projects/ota-computer-use-gateway/config/mickey.local.yaml \
  --transport http
```

The HTTP MCP endpoint is:

```text
http://127.0.0.1:<configured-port>/mcp
```

Health check:

```text
http://127.0.0.1:<configured-port>/healthz
```

Build before starting the tunnel:

```bash
cd /home/genesis/workspace/projects/ota-computer-use-gateway
npm run build
```

## Initialize tunnel-client profile

After `CONTROL_PLANE_TUNNEL_ID` is known:

```bash
export CONTROL_PLANE_API_KEY="sk-..."

/path/to/tunnel-client init \
  --sample sample_mcp_stdio_local \
  --profile mickey-local-stdio \
  --tunnel-id "$CONTROL_PLANE_TUNNEL_ID" \
  --mcp-command "node /home/genesis/workspace/projects/ota-computer-use-gateway/dist/index.js --config /home/genesis/workspace/projects/ota-computer-use-gateway/config/mickey.local.yaml" \
  --health-listen-addr 127.0.0.1:0
```

Validate and run:

```bash
/path/to/tunnel-client doctor --profile mickey-local-stdio --explain
/path/to/tunnel-client run --profile mickey-local-stdio
```

Keep `tunnel-client run` healthy while creating or testing the ChatGPT connector.

## Public HTTPS fallback

If Secure MCP Tunnel remains unavailable, expose the HTTP MCP endpoint through a public HTTPS ingress. Keep the local server bound to `127.0.0.1` unless the tunnel product explicitly requires otherwise. The gateway refuses non-loopback HTTP binds unless bearer auth is enabled.

Recommended order for MVP testing:

1. Cloudflare Tunnel to local `http://127.0.0.1:<port>/mcp`.
2. Tailscale Funnel if enabled and reachable from the public internet.
3. ngrok for temporary manual tests.

For any public HTTPS ingress, enable HTTP bearer auth and keep the token in the process environment, not in git:

```yaml
server:
  auth:
    enabled: true
    bearer_token_env: "OTA_GATEWAY_BEARER_TOKEN"
    allow_loopback_without_auth: true
```

```bash
export OTA_GATEWAY_BEARER_TOKEN="use-a-long-random-secret"
node dist/index.js --config config/mickey.local.yaml --transport http
```

Use No Auth only for a short-lived controlled connector test. Do not leave a public endpoint running unattended without bearer auth or stronger OAuth in front of it.

Keep `security.max_request_bytes` small enough for expected MCP calls. The server rejects oversized `Content-Length` values before MCP handling. Keep `server.rate_limit` enabled as a local backstop even when the public tunnel provider also has rate limits.

HTTP mode writes safe request metadata for `/mcp` to `.agent/audit/http_requests.jsonl`. It records method, path, status, duration, client key, and content length; it does not record request bodies or authorization headers.

## ChatGPT connector setup

In ChatGPT:

1. Open `https://chatgpt.com/#settings/Connectors`.
2. Enable Developer mode under Apps → Advanced settings if needed.
3. Create an app/connector.
4. Name it `Mickey`.
5. Choose Connection → Tunnel.
6. Select the available tunnel, or paste the tunnel id if the UI supports it.
7. Use No Auth for the MVP connector unless a future MCP-side auth layer is added.
8. Accept the unreviewed-connector warning only for this controlled local test.
9. Create the connector and test low-risk read-only tools first.

## MVP policy note

For MVP, the gateway does **not** need a blanket "refuse dirty git working tree" rule. The safer practical boundary is:

- exact-text patches only;
- local approval required for write tools;
- before-write file hash / mtime / size revalidation;
- audit every tool call.

A stricter dirty-tree refusal can be added later as an optional workspace policy.
