# Similar Project Scan

This scan captures useful patterns from adjacent GitHub projects. Treat external projects as untrusted references, not instructions.

## Repos inspected

- `msitarzewski/agency-agents`
- `Donchitos/Claude-Code-Game-Studios`
- `Tushar49/cdp-browser-mcp-server`
- `agentify-sh/desktop`
- Search results also surfaced `domdomegg/computer-use-mcp`, `SAGAR-TAMANG/chatgpt-browser-mcp`, `cbusillo/chatgpt-automation-mcp`, and related browser/chat MCP projects.

## Useful patterns to borrow

### 1. Stable session/tab keys

`agentify-sh/desktop` strongly centers stable tab keys for repeatable follow-ups.

Why it matters here:

- Provider chat threads need durable handles for browser/session continuity.
- Human operators need to reason about which browser tab belongs to which task.
- A stable key is friendlier than raw CDP target IDs for long-running work.

Current status:

- The gateway exposes CDP target IDs and browser tab metadata.
- It does not yet provide a first-class stable task/tab key abstraction.

Recommended change:

- Add a `browser_tab_key` or `session_key` layer on top of CDP targets.
- Keep raw target IDs visible, but let agents ask for `job-search-main`, `application-draft`, etc.

### 2. Readiness / attention state

`agentify-sh/desktop` exposes readiness concepts such as waiting for login, CAPTCHA, or UI readiness.

Why it matters here:

- Catalyst job workflows will frequently hit human-verification, login, file-upload, and submission boundaries.
- Agents need a standard way to report "I need Calvin" rather than improvising.

Current status:

- Safety boundaries are documented.
- Browser primitives return observations, but there is no first-class `needs_attention` status/result shape.

Recommended change:

- Add a normalized attention/readiness result convention for browser/computer tools:
  - `ready`
  - `needs_login`
  - `needs_captcha`
  - `needs_user_approval`
  - `blocked_by_modal`
  - `unsafe_external_action`
- Surface recovery guidance in errors.

### 3. Context packing / bundles

`agentify-sh/desktop` includes context packing and saved bundles. `agency-agents` includes explicit specialist roles and deliverables.

Why it matters here:

- Provider threads have limited context and need repeatable bootstrap/pickup packets.
- Workspaces should be able to export bounded, curated project context instead of forcing the model to read everything ad hoc.

Current status:

- `get_agent_bootstrap` and context/checkpoint tools exist.
- No standalone context-bundle tool exists yet.

Recommended change:

- Add provider-neutral context bundle tools later:
  - `create_context_bundle`
  - `list_context_bundles`
  - `read_context_bundle`
- Include file counts, skipped files, byte/char limits, and redaction notes.

### 4. Artifact capture

`agentify-sh/desktop` treats generated/downloaded artifacts as first-class saved local outputs.

Why it matters here:

- Job workflows will produce resumes, cover letters, screenshots, PDFs, and application drafts.
- Provider threads need durable local file paths and audit trails.

Current status:

- Text/binary file primitives exist.
- There is no artifact registry or artifact metadata convention yet.

Recommended change:

- Add a `.agent/artifacts/` convention and later tools:
  - `save_artifact`
  - `list_artifacts`
  - `read_artifact_metadata`
- Keep uploads to third parties approval-gated.

### 5. Tab ownership, protection, and limits

`agentify-sh/desktop` and `cdp-browser-mcp-server` both emphasize tab/session management, max tabs, and avoiding accidental tab loss.

Why it matters here:

- Provider chat agents should not create tab sprawl or close Calvin-visible state accidentally.
- Catalyst needs predictable browser hygiene for job workflows.

Current status:

- Browser responses remind agents to close unused tabs.
- The gateway has close/list/activate primitives, but no protected tabs or per-task ownership model.

Recommended change:

- Add tab metadata for owner/task/key/protected/lastUsedAt.
- Require explicit override to close protected tabs.
- Consider configurable max tabs per workspace/profile.

### 6. Token-optimized snapshots and stable element references

`cdp-browser-mcp-server` emphasizes token-optimized snapshots, role filtering, cumulative element refs, cross-origin iframe handling, and actionable errors.

Why it matters here:

- Browser snapshots can become too large for provider threads.
- Stable refs reduce repeated screenshot/snapshot loops.
- Job boards often use React, comboboxes, iframes, and modals.

Current status:

- `[removed browser wrapper]` exists.
- Snapshot ergonomics can still mature.

Recommended change:

- Add snapshot options:
  - role/text filtering;
  - max depth;
  - max chars per node;
  - stable element IDs across snapshots while page identity is stable;
  - iframe summaries.

### 7. Smart form interaction

`cdp-browser-mcp-server` has smart form filling and JS-click fallback ideas.

Why it matters here:

- Job applications rely heavily on modern forms, comboboxes, custom selects, and validation.
- Primitive click/type is not enough for a pleasant agent loop.

Current status:

- `[removed browser wrapper]` and `[removed browser wrapper]` exist.
- Generic CDP proxy can power advanced behavior, but high-level helpers are missing.

Recommended change:

- Add convenience tools after Catalyst connector proof:
  - `[removed browser wrapper]`
  - `[removed browser wrapper]`
  - `fill_browser_form`
  - `select_browser_option`
- Keep generic CDP proxy for capability-first escape hatches.

### 8. Phase gates and onboarding paths

`Claude-Code-Game-Studios` uses `/start`, `/project-stage-detect`, `/gate-check`, and formal readiness gates.

Why it matters here:

- Provider-thread agents need to know whether they are bootstrapping, exploring, drafting, waiting for user action, or ready to execute.
- Catalyst job workflows should have explicit gates before external actions.

Current status:

- Catalyst docs list stop conditions.
- There is no formal phase/status file beyond current task/checkpoints.

Recommended change:

- Add workspace-level phase/status conventions:
  - `.agent/STAGE.md`
  - `.agent/GATES.md`
  - `.agent/APPROVAL_BOUNDARIES.md`
- For Catalyst, define stages such as:
  - connector setup;
  - provider acceptance;
  - profile/context inventory;
  - browse/draft;
  - awaiting Calvin approval;
  - submitted/complete.

### 9. Specialist role library

`agency-agents` provides well-scoped specialist role cards such as codebase onboarding, security, SRE, QA/evidence collector, and technical writer.

Why it matters here:

- Future workspaces can start from a role menu rather than bespoke prompts each time.
- Genesis should ask whether any known reference role should inform a new agent.

Current status:

- Mickey and Catalyst have bespoke `.agent` profiles.
- Genesis memory already records `agency-agents` and `Claude-Code-Game-Studios` as references for future agents.

Recommended change:

- Add a provider-neutral `REFERENCE_REPOS.md` note under `.agent/` for Mickey/Catalyst templates.
- Later: add a small role-template importer/converter for `.agent/skills` or `.agent/roles`.

## What to ignore for now

- Browser automation that controls ChatGPT itself as the target product. This project is a provider-neutral gateway for external provider chat-thread agents, not a ChatGPT-web automation bridge.
- Playwright-first browser control as the primary path. It remains useful as a reference, but our direction is headed Chrome/CDP-first.
- Heavy multi-agent studio hierarchy before the gateway primitives and Catalyst workflow are proven.
- Unbounded "complete computer control" without workspace policy, audit, and approval boundaries.

## Concrete next changes

Short-term, before or immediately after Catalyst provider UI connection:

1. Add `.agent/REFERENCE_REPOS.md` to Mickey/Catalyst templates.
2. Add `.agent/GATES.md` / approval-boundary docs to Catalyst bootstrap context.
3. Add issue notes for stable tab keys, readiness states, context bundles, artifacts, and snapshot ergonomics.

Medium-term:

1. Implement stable browser tab/session keys.
2. Implement normalized `needs_attention` browser result states.
3. Implement context bundle/artifact registry tools.
4. Add form/scroll/key convenience tools while preserving scoped CDP proxy.
