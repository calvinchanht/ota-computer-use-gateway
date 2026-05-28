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

The HTTP mode also exposes `GET /healthz` for local/tunnel health checks.

See GitHub issue #1 for the source-of-truth implementation plan.
