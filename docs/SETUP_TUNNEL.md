# Secure MCP Tunnel Setup

This project is designed for OpenAI Secure MCP Tunnel. The local MCP server runs as a stdio MCP command; `tunnel-client` runs beside it and connects outbound to OpenAI.

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
