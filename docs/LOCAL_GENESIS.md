# Local Genesis MVP Runbook

This is the first target-machine runbook for the Genesis VPS.

## Install

```bash
cd /home/genesis/workspace/projects/ota-computer-use-gateway
npm install
npm run check
npm run smoke:stdio
```

## Local config

Copy the example and edit workspace roots if needed:

```bash
cp config/genesis.example.yaml config/genesis.local.yaml
```

Do not commit `config/*.local.yaml`.

## Run over stdio

```bash
npm run build
node dist/index.js --config config/genesis.local.yaml
```

The Secure MCP Tunnel client should launch or connect to this local command when the connector step begins.

## Panic stop

Create this file in a workspace to block non-low-risk tools:

```text
.agent/PANIC_STOP
```

Remove it only after verifying why it was created.
