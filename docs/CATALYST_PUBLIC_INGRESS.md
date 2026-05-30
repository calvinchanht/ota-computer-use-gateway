# Catalyst Public Ingress

Catalyst MCP is publicly exposed through a Genesis-hosted Cloudflare Tunnel relay.

## Endpoint

```text
https://catalyst-mcp.unrealize.com/mcp
```

Health:

```text
https://catalyst-mcp.unrealize.com/healthz
```

## Topology

```text
Provider connector
  -> Cloudflare hostname catalyst-mcp.unrealize.com
  -> Genesis cloudflared tunnel catalyst-mcp
  -> Genesis SSH local forward 127.0.0.1:8767
  -> PersonalVPS Catalyst MCP 127.0.0.1:8766
```

This keeps Cloudflare account credentials on Genesis instead of copying them to PersonalVPS.

## Genesis services

```text
catalyst-mcp-ssh-forward.service
catalyst-cloudflared.service
```

Service files:

```text
/home/genesis/.config/systemd/user/catalyst-mcp-ssh-forward.service
/home/genesis/.config/systemd/user/catalyst-cloudflared.service
```

Cloudflare config:

```text
/home/genesis/.cloudflared/catalyst-mcp.yml
```

Cloudflare tunnel:

```text
name: catalyst-mcp
id: 9a99ed41-fc58-4428-9d9f-996fee613373
hostname: catalyst-mcp.unrealize.com
```

## PersonalVPS service

Catalyst origin service:

```text
/home/molt/.config/systemd/user/catalyst-mcp-http.service
```

Origin URL on PersonalVPS:

```text
http://127.0.0.1:8766/mcp
```

Origin config:

```text
/home/molt/ota-computer-use-gateway/config/catalyst.local.yaml
```

Bearer token path:

```text
/home/molt/secrets/ota-computer-use-gateway/catalyst-bearer-token
```

Do not paste the bearer token into chat, issues, docs, or logs.

## Health checks

On Genesis:

```bash
systemctl --user is-active catalyst-mcp-ssh-forward.service catalyst-cloudflared.service
curl -fsS http://127.0.0.1:8767/healthz
curl -fsS https://catalyst-mcp.unrealize.com/healthz
```

On PersonalVPS:

```bash
systemctl --user is-active catalyst-mcp-http.service
curl -fsS http://127.0.0.1:8766/healthz
```

## Public validation

From the repo on Genesis, load the token without printing it:

```bash
TOKEN=$(/home/genesis/workspace/bin/genesis-host-ops-ssh.sh \
  molt@91.99.91.203 \
  'cat /home/molt/secrets/ota-computer-use-gateway/catalyst-bearer-token')

OTA_GATEWAY_SMOKE_URL=https://catalyst-mcp.unrealize.com/mcp \
OTA_GATEWAY_SMOKE_TOKEN="$TOKEN" \
OTA_GATEWAY_SMOKE_WORKSPACE=catalyst \
OTA_GATEWAY_SMOKE_EXPECT_SKILL=catalyst-pickup \
npm run smoke:public

OTA_GATEWAY_SMOKE_URL=https://catalyst-mcp.unrealize.com/mcp \
OTA_GATEWAY_SMOKE_TOKEN="$TOKEN" \
OTA_GATEWAY_ACCEPTANCE_WRITE=1 \
npm run smoke:catalyst-acceptance
```

## Recovery notes

If public health fails:

1. Check Genesis services:
   ```bash
   systemctl --user status catalyst-mcp-ssh-forward.service catalyst-cloudflared.service --no-pager -l
   ```
2. Check the Genesis local forward:
   ```bash
   curl -fsS http://127.0.0.1:8767/healthz
   ```
3. Check PersonalVPS origin:
   ```bash
   /home/genesis/workspace/bin/genesis-host-ops-ssh.sh molt@91.99.91.203 \
     'systemctl --user status catalyst-mcp-http.service --no-pager -l; curl -fsS http://127.0.0.1:8766/healthz'
   ```
4. Restart only the failing layer:
   ```bash
   systemctl --user restart catalyst-mcp-ssh-forward.service
   systemctl --user restart catalyst-cloudflared.service
   ```
   or on PersonalVPS:
   ```bash
   systemctl --user restart catalyst-mcp-http.service
   ```

Do not restart `dorami-openclaw.service` for Catalyst MCP ingress issues unless the problem is explicitly in the existing OpenClaw lane.
