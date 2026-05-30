# Catalyst Provider Connector Setup

Catalyst is ready for provider connector setup after public acceptance smoke passes.

## Public endpoint

Use this MCP endpoint:

```text
https://catalyst-mcp.unrealize.com/mcp
```

Health endpoint:

```text
https://catalyst-mcp.unrealize.com/healthz
```

## Authorization

Use API key / bearer-token authorization in the provider connector.

The Catalyst bearer token is stored server-side on PersonalVPS at:

```text
/home/molt/secrets/ota-computer-use-gateway/catalyst-bearer-token
```

Do not paste the token into chat, issues, docs, shell history, or screenshots. Copy it only into the provider connector's secret/API-key field.

## Connector intent

Name suggestion:

```text
Catalyst MCP
```

Description suggestion:

```text
Catalyst workspace MCP gateway for browser-based job-application workflows.
```

## First provider-thread message

After the connector is enabled, start a fresh provider chat thread and use this instruction:

```text
You are Catalyst, an OpenClaw-like workspace agent for Calvin's browser-based job-application workflows.

Start by calling:

get_agent_bootstrap({ "workspace_id": "catalyst" })

Then orient from agent_start_here, agent_profile, current_task, recent_handoff, recent_progress, recent_checkpoints, and next_actions.

For the startup/resume runbook, call:

list_skills({ "workspace_id": "catalyst" })
read_skill({ "workspace_id": "catalyst", "name": "catalyst-pickup" })

Before browser work, call:

list_browser_profiles({ "workspace_id": "catalyst" })
browser_status({ "workspace_id": "catalyst" })
list_browser_tabs({ "workspace_id": "catalyst" })

Operate as a workspace agent: inspect context, use scoped browser/CDP tools, record continuity, and stop for Calvin before CAPTCHA/human verification, submissions, account creation, uploads, credentials, or irreversible external actions.

Close unused browser tabs.
```

The same prompt is available in the Catalyst workspace at:

```text
/home/molt/personal-dora/catalyst-home/workspace/.agent/PROVIDER_THREAD_PROMPT.md
```

## Acceptance check from the provider thread

A fresh provider thread should be able to run:

1. `get_agent_bootstrap({ "workspace_id": "catalyst" })`
2. `get_workspace_policy({ "workspace_id": "catalyst" })`
3. `get_tool_profile({})`
4. `list_skills({ "workspace_id": "catalyst" })`
5. `read_skill({ "workspace_id": "catalyst", "name": "catalyst-pickup" })`
6. `list_browser_profiles({ "workspace_id": "catalyst" })`
7. `browser_status({ "workspace_id": "catalyst" })`
8. `list_browser_tabs({ "workspace_id": "catalyst" })`
9. `checkpoint_thread(...)`
10. `get_agent_bootstrap({ "workspace_id": "catalyst" })` and verify the checkpoint appears.

## Safety boundaries

Catalyst may browse and draft, but must stop for Calvin before:

- CAPTCHA, Turnstile, or human verification;
- job submission;
- account creation;
- document upload to a third party;
- credential or secret use;
- external messages/email;
- payment, terms acceptance, or irreversible external actions.

## Operator validation commands

From the repo, with the bearer token loaded without printing it:

```bash
TOKEN=$(ssh catalyst-host 'cat /home/molt/secrets/ota-computer-use-gateway/catalyst-bearer-token')

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

Replace `ssh catalyst-host ...` with the appropriate host-access helper. Do not echo the token.
