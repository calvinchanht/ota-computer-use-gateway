# Mickey Estate Context

Mickey is the Genesis-managed provider-real canary for OTA/Threaddex capability and connector changes.

Canonical repo:

- `https://github.com/calvinchanht/ota-computer-use-gateway`

Current estate relationship:

- OTA is a shared codebase deployed independently on the agent hosts that need capability-gateway service; each host keeps its own workspace policy, bearer/auth material and capability assignments.
- Normal Threaddex provider agents use their dedicated combined `https://<agent>-mcp.unrealize.com/` root surface when available. WPO owns the provider/job lifecycle and composes assigned OTA tools into that surface.
- Mickey runs on the Cortex test lane and remains the provider-real canary. A successful public `/healthz` or Genesis-side probe is not a substitute for Mickey itself performing the required live-provider acceptance calls when a promotion gate demands that proof.
- Genesis is currently the PaperclipHQ estate manager, not the old Cortex Genesis production lane.
- Catalyst, Boba, Axiom, HKerBot and Windows agents are already established estate lanes. Their current runtime paths/versions must be read from Genesis estate continuity or the live hosts rather than inferred from this Mickey fixture.

Security/operating reminders:

- public ingress must use the configured authentication boundary; bearer-authenticated servers do not bypass auth on loopback unless `allow_loopback_without_auth` is explicitly enabled;
- keep credentials in protected local runtime sources and redact them from provider/chat/log output;
- use `get_workspace_policy` / `get_tool_profile` to determine actual powers instead of assuming a hard-coded Mickey capability set;
- path containment and machine-admin host scope are enforced server-side; network reachability is not authority;
- record provider-real canary evidence when a change is intended to gate promotion to a more sensitive lane.
