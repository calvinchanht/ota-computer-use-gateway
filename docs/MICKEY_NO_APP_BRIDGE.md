# Mickey No-App Bridge

Mickey now treats ChatGPT Projects as the **agent shell** and the Gateway JSON API as the **runtime**.

OpenAI Apps/MCP is intentionally not the core Mickey path. The removed `Mickey` / `Mickey Gateway` app entries were useful discovery experiments, but they created namespace/cache/tool-availability confusion in the webchat model.

## Architecture

```text
ChatGPT Project thread
  - identity/source/current-task context
  - asks/answers in natural language
  - does not own runtime tools

External bridge/orchestrator
  - reads or is given the Project thread intent
  - binds provider/project/thread identity explicitly
  - calls scoped Gateway JSON API
  - posts/summarizes results back to the thread or Calvin

Gateway JSON API
  - authenticates/scopes by bearer token
  - executes allowed workspace tools
  - writes audit/continuity
  - returns run ids for recovery
```

## Core endpoints

```text
POST /api/v1/tool
POST /api/v1/batch
GET  /api/v1/runs/{run_id}
GET|POST /api/v1/debug/request_context
```

Every `/tool` and `/batch` response includes:

```json
{
  "api": {
    "transport": "http-json",
    "run_id": "uuid",
    "status": "completed"
  }
}
```

If a provider stream fails after execution, retrieve the result with:

```bash
node scripts/mickey-gateway-bridge.mjs --get-run <run_id>
```

Use `idempotency_key` / `--idempotency-key` on retries to avoid duplicate execution.

## Bridge helper

Default batch smoke:

```bash
node scripts/mickey-gateway-bridge.mjs --batch --idempotency-key mickey-bridge-smoke-001
```

Single tool call:

```bash
node scripts/mickey-gateway-bridge.mjs \
  --tool read_file \
  --arguments '{"workspace_id":"mickey","path":"chatgpt-projects/mickey/CURRENT_TASK.md"}' \
  --idempotency-key mickey-read-current-task-001
```

Continuity checkpoint:

```bash
node scripts/mickey-gateway-bridge.mjs \
  --tool checkpoint_thread \
  --arguments '{"workspace_id":"mickey","title":"Bridge checkpoint","summary":"What happened","next_steps":["Next action"]}' \
  --idempotency-key mickey-checkpoint-001
```

Intent packet from a Project chat or operator:

```bash
node scripts/mickey-gateway-bridge.mjs --intent-file docs/examples/mickey-bridge-intent.json
```

The intent file shape is:

```json
{
  "objective": "What the bridge should accomplish",
  "idempotency_key": "stable-retry-key",
  "thread": { "provider": "chatgpt", "project_id": "...", "thread_id": "..." },
  "calls": [
    { "tool": "workspace_status", "arguments": {} },
    { "tool": "read_file", "arguments": { "workspace_id": "mickey", "path": "chatgpt-projects/mickey/CURRENT_TASK.md" } }
  ]
}
```

## Thread binding

The bridge defaults to the current Mickey Project chat identity:

```json
{
  "provider": "chatgpt",
  "project_id": "g-p-6a1cac252ea88191a6d0e6522a429765-mickey",
  "thread_id": "6a1cad6a-6ae8-8329-b312-eddfa767ac30",
  "thread_url": "https://chatgpt.com/g/g-p-6a1cac252ea88191a6d0e6522a429765-mickey/c/6a1cad6a-6ae8-8329-b312-eddfa767ac30"
}
```

Do not rely on implicit `Referer` / `Origin`; ChatGPT MCP calls did not send Project/chat URLs. Thread identity must be explicit.

## Operating loop

1. Ask the Mickey Project chat to reason from Project/source context.
2. Extract the concrete tool/API intent.
3. Run the bridge helper or orchestrator against the scoped Gateway JSON API.
4. Return concise results to the chat/user.
5. Use `checkpoint_thread` or `memory_write` after meaningful progress so pickup is durable.
6. If stream/UI fails, recover by `run_id` instead of rerunning blindly.

## Safety posture

- No raw bearer tokens in chat, issue comments, logs, or prompts.
- Gateway token scopes workspace/tools server-side.
- CAPTCHA/human verification, payments, terms acceptance, external messages, third-party uploads/submissions, and irreversible destructive actions remain Calvin-only.
- OpenAI Apps/MCP can be revisited later as compatibility, but it should not be allowed to reintroduce Mickey namespace/tool confusion.
