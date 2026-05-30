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
.agent/PROJECT_CONTEXT.md
.agent/CURRENT_TASK.md
.agent/DECISIONS.md
.agent/HANDOFF.md
.agent/PROGRESS.md
.agent/CHECKPOINTS.md
.agent/MEMORY_LOG.jsonl
```

This layout is intentionally simple and local. It can later be indexed or superseded by OTA Context Store without changing the basic checkpoint/export habit.

## Validation

The local primitive smoke now exercises both primitive tools and the context pickup/checkpoint tools:

```bash
npm run smoke:primitives
```

The public smoke checks deployed/tunneled context pickup too:

```bash
export OTA_GATEWAY_SMOKE_URL="https://mickey-mcp.example.com/mcp"
export OTA_GATEWAY_SMOKE_TOKEN="..."
npm run smoke:public
```

With explicit write opt-in, the public smoke also records progress, decisions, and a checkpoint:

```bash
export OTA_GATEWAY_SMOKE_WRITE=1
npm run smoke:public
```
