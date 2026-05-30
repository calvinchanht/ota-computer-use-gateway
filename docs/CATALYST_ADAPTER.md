# Catalyst Adapter MVP

Catalyst is the next workspace after Mickey's provider-thread proof.

Goal: let a provider chat thread pick up Catalyst's workspace, browser posture, skills, and continuity for browser-based job-application workflows without turning the provider thread into a lesser/toy agent.

## Sequencing

1. Mickey proves the OpenClaw-like chat-thread startup loop.
2. Catalyst reuses that pattern with its own workspace identity, prompt, pickup skill, acceptance checklist, and browser profile.
3. Catalyst starts with safe browser-job pickup flows.
4. External submissions, CAPTCHA/Turnstile, human verification, sensitive account decisions, and irreversible external actions remain Calvin-only/explicitly approved.
5. Deeper Boba/Mac CUADriver work stays deferred until Catalyst is practical.

## Config starting point

Use `config/catalyst.example.yaml` as the deployment template.

Before deploying, verify on the host running the gateway:

- Catalyst workspace root;
- headed Chrome profile path;
- display;
- CDP host/port;
- whether public ingress needs Cloudflare Tunnel, Tailscale Funnel, or another HTTPS route;
- bearer auth and `allow_loopback_without_auth: false` for public tunnel mode.

The example intentionally uses workspace/profile labels named `catalyst`, not generic `default`.

## Workspace agent files

Mirror Mickey's proven `.agent` shape in the Catalyst workspace:

```text
.agent/AGENT_START_HERE.md
.agent/PROVIDER_THREAD_PROMPT.md
.agent/CATALYST_PROVIDER_ACCEPTANCE.md
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
.agent/skills/catalyst-pickup/SKILL.md
```

Catalyst's provider thread prompt should instruct a fresh thread to call:

```text
get_agent_bootstrap({ "workspace_id": "catalyst" })
```

Then read `catalyst-pickup` through `list_skills` / `read_skill`.

## Browser/job workflow safety

Catalyst may need screen/browser capability enabled, but capability is not permission to submit or bypass.

The provider thread must stop for Calvin before:

- CAPTCHA, Turnstile, or human verification;
- creating accounts;
- sending job applications;
- sending email/messages;
- uploading private documents to a third party;
- accepting terms or making commitments;
- using credentials/secrets not already safely configured server-side.

Browser tools should remain scoped through configured profiles and target IDs. Use explicit helpers first, then `browser_cdp_call` / `browser_cdp_batch` for scoped CDP capability when helpers are too narrow.

Close unused tabs.

## Acceptance flow

A fresh provider thread should be able to:

1. call `get_agent_bootstrap({ "workspace_id": "catalyst" })`;
2. read Catalyst start-here/profile/acceptance context;
3. call `get_workspace_policy({ "workspace_id": "catalyst" })`;
4. call `get_tool_profile({})`;
5. call `list_skills({ "workspace_id": "catalyst" })`;
6. call `read_skill({ "workspace_id": "catalyst", "name": "catalyst-pickup" })`;
7. call `list_browser_profiles({ "workspace_id": "catalyst" })`;
8. call `browser_status({ "workspace_id": "catalyst" })`;
9. call `list_browser_tabs({ "workspace_id": "catalyst" })`;
10. record a checkpoint with `checkpoint_thread`;
11. verify that checkpoint through `get_agent_bootstrap`.

This should become a focused `smoke:catalyst-acceptance` once the deployed Catalyst route and root are known.
