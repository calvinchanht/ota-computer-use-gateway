# Mickey Workspace

> Historical prototype note (2026-05/06): this document records the original Mickey workspace proof. Current provider agents normally use the combined Threaddex root MCP at `https://<agent>-mcp.unrealize.com/`; direct OTA JSON/MCP surfaces remain capability backends and compatibility/debug lanes. Paths, connector assumptions, and approval wording below are point-in-time evidence, not the canonical setup contract. Use `README.md`, `SECURITY.md`, `API_CAPABILITY_SETS.md`, and the WPO `AGENT_SETUP_RUNBOOK.md` for current setup.

Mickey was the first local computer-use testing workspace for OTA Computer-Use Gateway and remains the provider-real canary lane.

Mickey represents the Human Connector test mode:

```text
Calvin manually talks to a web chat thread
  -> web thread reasons about the task
  -> local MCP gateway exposes safe tools
  -> Mickey workspace enforces policy, context, audit, and approval
```

## Local Genesis setup

The local, ignored config is:

```text
config/mickey.local.yaml
```

It points workspace id `mickey` at the local checkout:

```text
/home/genesis/workspace/projects/ota-computer-use-gateway
```

## Context files

Mickey uses normal workspace-local context files under `.agent/`:

- `.agent/PROJECT_CONTEXT.md`
- `.agent/CURRENT_TASK.md`
- `.agent/DECISIONS.md`
- `.agent/MEMORY_LOG.jsonl`
- `.agent/audit/tool_calls.jsonl`

These are intentionally not committed.

## Current verified smoke

The local MCP server was run with `config/mickey.local.yaml` and successfully exercised:

- `heartbeat`
- `get_project_context`
- `git_status`
- `memory_write`

The normal project gates also pass:

```bash
npm run check
npm run smoke:stdio
```

## No-App bridge runtime

During the 2026-05 no-App bridge experiment, Mickey temporarily stopped using an OpenAI Apps/MCP connector as its core runtime path: the ChatGPT Project acted as the identity/source/current-task shell and an external bridge called the scoped Gateway JSON API. That experiment is documented in [`MICKEY_NO_APP_BRIDGE.md`](MICKEY_NO_APP_BRIDGE.md); it is not the current canonical provider topology.
