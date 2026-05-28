# Mickey Workspace

Mickey is the first local computer-use testing workspace for OTA Computer-Use Gateway.

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
