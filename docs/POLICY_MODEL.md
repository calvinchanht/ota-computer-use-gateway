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

Host/lane administration and full assigned-machine management. A webchat agent with `machine_admin: true` is intended to be at least as capable as the corresponding OpenClaw lane, not a toy sandbox. For that agent's own machine this means:

- the workspace root SHOULD be `/` unless there is a deliberate narrower-lane reason;
- the agent SHOULD have access to its own machine sudo/admin credential, usually the local `molt` account password, installed in a protected local credential path;
- the agent SHOULD have a non-printing sudo/admin helper so most privileged tasks do not require pasting raw passwords;
- ordinary local inspection, service management, package diagnostics, filesystem edits, tunnel repair, and root-owned path inspection are routine machine-admin work when requested or needed;
- raw credential values still must not be pasted into chat/logs/issues unless Calvin explicitly asks for exact disclosure/use.

Typical operations include:

- `run_configured_command` when exposed;
- bounded `run_command` with explicit argv;
- service lifecycle commands;
- sudo/admin helper invocations;
- tunnel/config/runbook operations.

`machine_admin` is intentionally separate from narrow workspace `run_command`, but a machine-admin lane may intentionally expose `/` as its workspace root plus a sudo helper. Confusing machine-admin with a read-only or project-only workspace makes webchat agents weaker than OpenClaw agents.

Machine-admin filesystem scope uses the same file tool vocabulary as workspace agents. Do not add duplicate `host_read_file` / `host_write_file` tools. Instead, policy decides scope:

- workspace-only lanes: file tools are limited to the configured workspace root;
- machine-admin lanes with `filesystem.machine_admin_host_scope: true`: file tools may resolve explicit absolute host paths inside `filesystem.host_root`;
- relative paths, including `../` escapes, remain workspace-root scoped and cannot implicitly jump into host scope;
- responses include `scope: workspace` or `scope: host` so audit/debugging can see which boundary was used;
- no hidden path, secret, credential, or glob deny lists apply; adding any such deny layer requires Calvin's explicit approval.

Example:

```yaml
workspaces:
  - id: genesis
    root: /home/genesis/workspace
    api_sets:
      workspace: true
      machine_admin: true
    filesystem:
      machine_admin_host_scope: true
      host_root: /
```


### `estate_admin`

Cross-agent/cross-host control-plane reports, diagnostics, continuity, and approved estate runbook operations.

## Stop boundaries

Agents must stop and ask Calvin when a workflow reaches:

- CAPTCHA or human verification;
- credentials, raw secrets, private keys, cookies, OAuth/PAT/bearer token exposure, or secret exfiltration when Calvin has not explicitly requested that use/disclosure;
- external messages, email, chat, public posts, or third-party sends;
- third-party uploads or form submissions;
- payments, purchases, subscriptions, or terms acceptance;
- account/security settings or identity verification;
- irreversible or out-of-scope destructive actions.

Routine scoped workspace edits, tmp cleanup, local scratch files, bounded workspace commands, and configured browser/computer operations inside the approved lane should not require provider-side per-call approval.
