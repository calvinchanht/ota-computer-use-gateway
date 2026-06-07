# Context Pickup and Checkpointing

Chat-thread agents differ from CLI/API agents. A CLI/API harness often pushes packed context into a fresh model run. A ChatGPT.com or Claude.ai-style thread already has provider-managed active context, so Tool Gateway should provide bootstrap, retrieval, and durable checkpoint/export rails.

## Operating model

```text
fresh or resumed thread calls get_agent_bootstrap
→ thread works inside provider-managed context
→ thread retrieves local details only when needed
→ thread checkpoints progress/decisions/current task/handoff outward
→ future thread picks up from durable workspace state
```

Avoid turning Tool Gateway into a heavy context injector. Deeper retrieval, memory ranking, session archives, and context packing belong in future OTA Context Store/Core layers.

## Bootstrap

Use `get_agent_bootstrap` as the first call in a fresh or resumed chat thread.

It returns an ordered startup packet with:

- workspace identity and capabilities;
- operating-model reminders;
- agent start-here instructions;
- provider-thread prompt text when present;
- provider acceptance checklist when present;
- agent profile slices such as soul/user/tools/estate context when present;
- project instructions;
- current task;
- recent handoff;
- recent progress;
- recent checkpoints;
- suggested next actions.

Use `get_context_snapshot` when a fuller raw view of continuity files is needed.

## Retrieval

Use retrieval tools on demand rather than asking the gateway to push everything every turn:

- `memory_search`
- `read_file`
- `search_files`
- `get_context_snapshot`

## Checkpoint/export tools

Use these to write durable state back to the VPS/workspace:

- `record_progress` — append progress notes to `.agent/PROGRESS.md`.
- `record_decision` — append decisions to `.agent/DECISIONS.md`.
- `update_current_task` — replace `.agent/CURRENT_TASK.md` with current task state.
- `record_handoff` — append handoff notes to `.agent/HANDOFF.md`.
- `checkpoint_thread` — append a structured checkpoint to `.agent/CHECKPOINTS.md`.

Call `checkpoint_thread` or `record_handoff` before stopping, switching threads, or handing work to another agent.

## Local files

The current lightweight continuity layout is:

```text
.agent/AGENT_START_HERE.md
.agent/PROVIDER_THREAD_PROMPT.md
.agent/MICKEY_PROVIDER_ACCEPTANCE.md
.agent/SOUL.md
.agent/USER.md
.agent/TOOLS.md
.agent/ESTATE_CONTEXT.md
.agent/PROJECT_CONTEXT.md
.agent/CURRENT_TASK.md
.agent/DECISIONS.md
.agent/HANDOFF.md
.agent/PROGRESS.md
.agent/CHECKPOINTS.md
.agent/MEMORY_LOG.jsonl
.agent/skills/<skill>/SKILL.md
```

This layout is intentionally simple and local. It can later be indexed or superseded by OTA Context Store without changing the basic checkpoint/export habit.

## Mickey provider-thread proof

Mickey is the first proof workspace for OpenClaw-like provider chat-thread agents. A fresh provider thread should be able to bootstrap, read its startup runbook, inspect tool/browser posture, and write a checkpoint without Calvin pasting a long hidden context bundle.

The key Mickey startup artifacts are:

- `.agent/AGENT_START_HERE.md` — concise workspace-agent startup instructions.
- `.agent/PROVIDER_THREAD_PROMPT.md` — first-message prompt text for provider threads.
- `.agent/MICKEY_PROVIDER_ACCEPTANCE.md` — manual acceptance checklist.
- `.agent/skills/mickey-pickup/SKILL.md` — startup/resume runbook exposed through `list_skills` / `read_skill`.

The provider-thread acceptance flow checks:

1. `get_agent_bootstrap({ "workspace_id": "mickey" })`
2. `get_workspace_policy({ "workspace_id": "mickey" })`
3. `get_tool_profile({})`
4. `list_skills({ "workspace_id": "mickey" })`
5. `read_skill({ "workspace_id": "mickey", "name": "mickey-pickup" })`
6. `list_browser_profiles({ "workspace_id": "mickey" })`
7. `browser_status({ "workspace_id": "mickey" })`
8. `list_browser_tabs({ "workspace_id": "mickey" })`
9. optionally `checkpoint_thread(...)`, then verify the checkpoint through `get_agent_bootstrap`.

## Validation

The local primitive smoke now exercises both primitive tools and the context pickup/checkpoint tools:

```bash
npm run smoke:primitives
```

The public smoke checks deployed/tunneled context pickup too:

```bash
export OTA_GATEWAY_SMOKE_URL="https://mickey-api.example.com/api/v1/tool"
export OTA_GATEWAY_SMOKE_TOKEN="..."
npm run smoke:public
```

With explicit write opt-in, the public smoke also records progress, decisions, and a checkpoint:

```bash
export OTA_GATEWAY_SMOKE_WRITE=1
npm run smoke:public
```

Mickey has a focused public acceptance smoke for the provider-thread proof:

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
