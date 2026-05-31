# Catalyst Provider Acceptance

Use this checklist in a fresh provider chat thread connected to the Catalyst MCP connector.

The goal is to prove the thread understands its OpenClaw-like agent capability surface and can use scoped MCP access to the Catalyst VPS workspace. Do not treat lack of raw SSH as lack of workspace access.

## Startup

1. `get_agent_bootstrap({ "workspace_id": "catalyst" })`
2. Read `operating_model`, `capability_discovery`, `agent_start_here`, `current_task`, `recent_handoff`, `recent_progress`, `recent_checkpoints`, and `next_actions` from the bootstrap output.

## Capability discovery

Before saying any capability is unavailable, inspect policy and the tool catalog:

1. `get_workspace_policy({ "workspace_id": "catalyst" })`
2. `get_tool_profile({})`

Confirm whether scoped file/process/browser/memory/skill/artifact tools are present and enabled by policy.

## Scoped workspace file access proof

These are MCP file tools against the configured Catalyst workspace root, not raw SSH:

1. `list_dir({ "workspace_id": "catalyst", "path": "." })`
2. `tree({ "workspace_id": "catalyst", "path": ".", "max_depth": 2 })`
3. `stat_path({ "workspace_id": "catalyst", "path": ".agent/AGENT_START_HERE.md" })`
4. `read_file({ "workspace_id": "catalyst", "path": ".agent/AGENT_START_HERE.md" })`

After this proof, explicitly state: "I have scoped Catalyst workspace file access through MCP tools; I do not need raw SSH for normal workspace inspection."

## Skills and continuity

1. `list_skills({ "workspace_id": "catalyst" })`
2. `read_skill({ "workspace_id": "catalyst", "name": "catalyst-pickup" })`
3. `list_artifacts({ "workspace_id": "catalyst" })`
4. `checkpoint_thread({ "workspace_id": "catalyst", "title": "provider acceptance checkpoint", "summary": "Fresh provider thread confirmed Catalyst MCP capability discovery and scoped file access.", "next_steps": ["Continue safe Catalyst workflow orientation."] })`
5. `get_agent_bootstrap({ "workspace_id": "catalyst" })` and verify the checkpoint appears.

## Browser/CDP readiness

If browser/screen/control policy is enabled:

1. `list_browser_profiles({ "workspace_id": "catalyst" })`
2. `browser_status({ "workspace_id": "catalyst" })`
3. `list_browser_tabs({ "workspace_id": "catalyst" })`
4. `browser_cdp_browser_call({ "workspace_id": "catalyst", "method": "Browser.getVersion" })`

Use page-target `browser_cdp_call` / `browser_cdp_batch` for DOM scripting when a tab is available.

## Stop boundaries

Catalyst may browse and draft, but must stop for Calvin before:

- CAPTCHA, Turnstile, or human verification;
- job submission;
- account creation;
- document upload to a third party;
- external credential use or raw secret disclosure outside the local task;
- external messages/email;
- payment, terms acceptance, or irreversible external actions.


## Autonomy / no-babysitting rule

Do not self-handicap. Routine scoped workspace operations are allowed when the MCP policy exposes the tool: read/list/stat/tree/search files, edit/write workspace files, run local workspace commands/processes, use browser/CDP, and use computer/CUA tools. Do not ask Calvin to confirm every local action. Stop only for explicit external/irreversible boundaries: CAPTCHA/human verification, external messages/email, payments/terms, third-party uploads/submissions, or irreversible/destructive actions. Do not self-block on local workspace file paths, including secrets/ or credential-named files; the gateway policy intentionally grants Catalyst full read/write/list access inside its workspace root. You may inspect local secret files when the task requires it, but do not paste raw token/key contents into chat or external systems unless Calvin explicitly asks for that exact disclosure/use.

The agent is not read-only when policy exposes write/edit/exec/process/browser/computer tools. `workspace_inventory` is read-only only as a metadata helper; use the full read/write/edit/exec surface when available.
