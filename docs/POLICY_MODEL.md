# Gateway policy model

This gateway should preserve OpenClaw-like agent power while making the boundary auditable.

## Principle

A webchat agent should not be lesser than an OpenClaw agent when Calvin intentionally enables a capability set. Safety wraps powerful primitives with scoping, auth, audit, redaction, bounded output, and stop boundaries. It should not replace real workspace/browser/computer primitives with toy wrappers.

## Capability sets

### `workspace`

Normal workspace-agent capability. This includes:

- scoped file read/write/edit/delete;
- tmp cleanup and routine file removal via `delete_file` / `delete_path`;
- patch/propose/apply helpers;
- git/context/skills/checkpoint/memory helpers;
- bounded `run_command` and process tools when workspace exec is enabled.

`delete_file` and `delete_path` are treated as ordinary scoped editing tools, not nuclear operations. Agents should be able to clear tmp files and manage their workspace without a dramatic approval prompt. The stop boundary is not "delete was called"; it is out-of-scope, irreversible, account/security, external, or destructive work beyond the intended workspace/task.

### `browser`

Scoped browser/CDP capability for preassigned browser profiles and ports. High-level helpers such as visible state, click-and-wait, tab management, and upload verification are convenience helpers around the native browser/CDP surface.

### `computer`

Local GUI/computer-use through Cua Driver: screenshots, windows, accessibility tree, mouse, keyboard, and local app control. This is powerful and should keep clear stop boundaries, but should remain a real computer-use surface when enabled.

### `machine_admin`

Host/lane administration. This gates configured/admin operations such as:

- `run_configured_command`;
- service restarts and systemd/launchd workflows;
- tunnel/config/deployment management;
- host/lane maintenance.

`machine_admin` is intentionally separate from bounded workspace `run_command`. Confusing these makes webchat agents weaker than OpenClaw agents.

### `estate_admin`

Cross-agent/cross-host control-plane reports, diagnostics, continuity, and approved estate runbook operations.

## Stop boundaries

Agents must stop and ask Calvin when a workflow reaches:

- CAPTCHA or human verification;
- credentials, raw secrets, private keys, cookies, OAuth/PAT/bearer token exposure, or secret exfiltration;
- external messages, email, chat, public posts, or third-party sends;
- third-party uploads or form submissions;
- payments, purchases, subscriptions, or terms acceptance;
- account/security settings or identity verification;
- irreversible or out-of-scope destructive actions.

Routine scoped workspace edits, tmp cleanup, local scratch files, bounded workspace commands, and configured browser/computer operations inside the approved lane should not require provider-side per-call approval.
