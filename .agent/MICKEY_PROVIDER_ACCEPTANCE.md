# Mickey Provider Thread Acceptance Test

Use this checklist to prove a provider chat thread can pick up Mickey as an OpenClaw-like workspace agent through OTA Tool Gateway.

## Preconditions

- ChatGPT/provider connector is pointed at Mickey API endpoint.
- Connector has the Mickey bearer token configured server-side/provider-side, not pasted into chat.
- Mickey service and Cloudflare tunnel are healthy.

## First Message

Paste or adapt the contents of `.agent/PROVIDER_THREAD_PROMPT.md` into the provider thread, or ask the thread to read `provider_thread_prompt` from `get_agent_bootstrap` after connecting.

## Required Tool Sequence

The provider thread should successfully run:

1. `get_agent_bootstrap({ "workspace_id": "mickey" })`
2. `get_workspace_policy({ "workspace_id": "mickey" })`
3. `get_tool_profile({})`
4. `list_skills({ "workspace_id": "mickey" })`
5. `read_skill({ "workspace_id": "mickey", "name": "mickey-pickup" })`
6. `list_browser_profiles({ "workspace_id": "mickey" })`
7. `browser_status({ "workspace_id": "mickey" })`
8. `list_browser_tabs({ "workspace_id": "mickey" })`

## Expected Agent Behavior

The provider thread should be able to summarize:

- it is Mickey;
- Mickey is the proof workspace, not Catalyst;
- it should act like an OpenClaw-style workspace agent;
- it has continuity files and should record progress/handoffs;
- browser/CDP is available through scoped profile/target tools and CDP proxy calls;
- Catalyst comes after Mickey proof;
- Boba/Mac CUADriver is deferred until after Catalyst browser-workspace anchoring.

## Minimal Write/Continuity Proof

Ask the provider thread to record a short checkpoint:

```text
checkpoint_thread({
  "workspace_id": "mickey",
  "title": "Provider acceptance smoke",
  "summary": "Provider thread successfully bootstrapped Mickey and read the pickup skill.",
  "next_steps": ["Continue Catalyst anchoring after Mickey proof is accepted."]
})
```

Then verify with:

```text
get_agent_bootstrap({ "workspace_id": "mickey" })
```

The checkpoint should appear in `recent_checkpoints`.

## Pass Criteria

Mickey passes this acceptance test when a fresh provider thread can:

- bootstrap itself without Calvin pasting long hidden context;
- read the Mickey pickup skill;
- inspect policy/tool/browser posture;
- accurately state its role and safety boundaries;
- write and then retrieve a checkpoint.
