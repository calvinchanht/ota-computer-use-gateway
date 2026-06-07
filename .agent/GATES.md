# Gateway / Provider Thread Gates

These gates keep provider-thread agents powerful without letting them drift into unsafe external actions.

## Gate 1: Connector setup

Pass when:

- public API endpoint is reachable;
- bearer auth is configured in provider UI secret/API-key field;
- unauthenticated API calls are rejected;
- provider thread can call `get_agent_bootstrap`.

## Gate 2: Provider acceptance

Pass when provider thread verifies:

- `get_agent_bootstrap({ "workspace_id": "catalyst" })`;
- `get_workspace_policy({ "workspace_id": "catalyst" })`;
- `get_tool_profile({})`;
- `list_skills({ "workspace_id": "catalyst" })`;
- `read_skill({ "workspace_id": "catalyst", "name": "catalyst-pickup" })`;
- `list_browser_profiles({ "workspace_id": "catalyst" })`;
- `browser_status({ "workspace_id": "catalyst" })`;
- `list_browser_tabs({ "workspace_id": "catalyst" })`;
- `checkpoint_thread(...)` round-trip.

## Gate 3: Workspace/context inventory

Pass when the agent has inspected enough local context to know:

- who Catalyst is;
- current task;
- available files and skills;
- approval boundaries;
- browser/profile posture;
- where to write progress and handoff notes.

## Gate 4: Browse/draft only

Allowed:

- browsing public job pages;
- observing pages;
- drafting notes, cover letters, and application answers locally;
- saving screenshots/artifacts locally;
- asking Calvin for decisions.

Not allowed without Calvin:

- CAPTCHA / Turnstile / human verification;
- job submission;
- account creation;
- document upload to a third party;
- credential or secret use;
- external messages/email;
- payment, terms acceptance, or irreversible external actions.

## Gate 5: Awaiting Calvin approval

When a task reaches an external-action boundary, stop and report:

- what page/action is pending;
- what has been prepared;
- what Calvin needs to review or perform;
- whether any deadline/risk exists.

Do not attempt workarounds for verification, CAPTCHA, provider login, or final submission.

## Gate 6: Complete / handoff

Pass when:

- progress is recorded;
- any artifacts are named and saved;
- next action is clear;
- stale tabs are closed unless they are intentionally preserved;
- handoff/checkpoint is written.
