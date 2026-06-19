# API Capability Sets

The gateway exposes provider-facing APIs as composable capability sets, not a linear level ladder. An agent can receive any combination of sets depending on its role.

Configure sets under `workspaces[].api_sets`:

```yaml
api_sets:
  workspace: true
  browser: true
  computer: false
  machine_admin: true
  estate_admin: false
```

## Sets

### Workspace API

Normal scoped agent workspace work:

- workspace inventory and file reads/writes within the configured root;
- artifacts and context/bootstrap tools;
- skills/scripts;
- bounded `run_command` / process tools when enabled;
- async run recovery through `/api/v1/runs/{run_id}`.

### Browser API

Browser/CDP automation using preassigned browser profiles and ports:

- browser profile/status/tab tools;
- visible page state;
- compact semantic actions such as click-and-wait and upload-and-verify;
- raw scoped CDP calls/batches when exposed.

Recommended browser slot naming for a new agent:

```yaml
browser:
  profiles:
    - label: "{agent_name}"
      cdp_port: 9222
    - label: "{agent_name}2"
      cdp_port: 9223
    - label: "{agent_name}3"
      cdp_port: 9224
```

Use actual non-conflicting ports for the host.

### Computer API

Local GUI/computer use, separate from machine administration:

- Cua Driver status/call/batch;
- screenshot artifacts;
- window/app state;
- accessibility tree;
- mouse/keyboard and local app control.

### Machine Admin API

Own-machine or own-lane management, not cross-estate power. For an agent assigned to manage its own host, `machine_admin: true` is a machine-control capability, not merely a label for a few preapproved commands. New own-machine admin lanes should normally provide:

- workspace root `/` for whole-machine path visibility;
- no hidden path, secret, credential, or glob deny lists; adding any such deny layer requires Calvin's explicit approval;
- an agent-owned audit directory outside `/.agent`, for example `/home/<agent>/workspace/.agent`, when root is `/`;
- the machine sudo/admin credential, usually the host `molt` password, available to the agent in a protected local path;
- a non-printing sudo/admin helper for root operations;
- durable runbook guidance that raw secret values must stay redacted unless Calvin explicitly requests exact disclosure/use.

Typical exposed powers include:

- own service/config/tunnel checks;
- configured commands for assigned service lifecycle;
- bounded `run_command` for host-local diagnostics and process/log work;
- sudo/admin helper invocations for root-owned paths and privileged repairs;
- scoped repairs for the agent's own machine/lane.

This posture intentionally matches OpenClaw-style machine control. Do not downscope a machine-admin webchat agent into a project-only toy sandbox unless Calvin explicitly asks for that narrower lane.

### Estate Admin API

Cross-agent/cross-host Genesis control-plane power:

- estate overview;
- agent and host deep dives;
- safe cross-estate diagnostics;
- approved runbook-oriented cross-host operations.

## Example assignments

```yaml
Catalyst:
  workspace: true
  browser: true
  computer: false
  machine_admin: false
  estate_admin: false

Cortex:
  workspace: true
  browser: true
  computer: false
  machine_admin: true
  estate_admin: false

Boba:
  workspace: true
  browser: true
  computer: true
  machine_admin: true
  estate_admin: false

Genesis:
  workspace: true
  browser: true
  computer: true
  machine_admin: true
  estate_admin: true
```

## Policy flags are separate

Capability sets do not automatically permit every kind of real-world action. Keep these as separate policy decisions:

```yaml
external_actions: none | workflow_approved | broad
destructive_actions: denied | approval_required
secret_return: never
credential_use: server_side_only
```

A webchat agent may have Computer API but still be forbidden from external messages, uploads, payment, terms acceptance, CAPTCHA/human-verification, account/security changes, or destructive deletes unless the workflow explicitly allows them.

## Enforcement notes

- `get_tool_profile` advertises the capability-set model.
- `get_workspace_policy` returns the resolved sets and allowed tools for the selected workspace.
- HTTP JSON calls are denied if the requested tool is not exposed by `server.exposed_tools` when that list is configured.
- HTTP JSON calls are denied if the requested tool is not in the selected workspace's resolved API-set policy.
- Existing `allow_*` fields remain backward-compatible; `api_sets` is the preferred new control-plane vocabulary.
