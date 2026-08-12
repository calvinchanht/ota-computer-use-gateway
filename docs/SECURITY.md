# Security model

OTA is a high-capability local/host gateway. Its security boundary is explicit authentication + workspace/capability scoping + filesystem containment + bounded I/O + audit/redaction. It is not a hidden deny-list sandbox.

## HTTP authentication and ingress

- The default HTTP bind is loopback (`127.0.0.1`). A non-loopback bind is refused unless `server.auth.enabled: true`.
- When bearer auth is enabled, every HTTP tool request requires the configured bearer token, including loopback requests, unless `server.auth.allow_loopback_without_auth: true` is explicitly set for a bounded compatibility case.
- Keep bearer values in environment/protected runtime configuration. Never put credentials in URLs, prompts, logs, screenshots, docs, or copied links.
- `security.max_request_bytes` bounds HTTP request bodies before tool/MCP handling. The default is 1,000,000 bytes.
- Rate limiting is enabled by default. Proxy-supplied client-IP headers are ignored unless `server.rate_limit.trust_proxy_headers` is explicitly enabled for a trusted proxy topology.
- Response, file, search, command, and managed-process limits come from the resolved config. Do not remove those bounds merely because an agent has a powerful capability set.

## Workspace and filesystem containment

- Workspace-relative paths resolve inside the configured workspace root; relative inputs containing a `..` segment are rejected rather than normalized into another scope.
- Reads resolve the real target path and re-check containment after symlink resolution.
- Writes resolve the nearest existing ancestor and final parent through `realpath`, then re-check an existing target through `realpath`. A symlink must not turn a workspace write into an out-of-bound write.
- Machine-admin host scope is opt-in. Only an absolute path may use host scope, and only when `api_sets.machine_admin` plus `filesystem.machine_admin_host_scope` are enabled. The path must still remain inside `filesystem.host_root`.
- OTA intentionally has no hidden path-name/secret-name/glob deny list. Access is controlled by workspace/host roots and capability policy. Do not add shadow deny logic without an explicit policy decision.

## Capability and tool policy

- `workspaces[].api_sets` is the preferred capability model: `workspace`, `browser`, `computer`, `computer_windows`, `machine_admin`, and `estate_admin` are composable rather than a privilege ladder.
- `server.exposed_tools`, when configured, is an additional allow surface and should be generated/synchronized from the resolved capability set instead of hand-maintained.
- `get_workspace_policy` and `get_tool_profile` are the machine-readable source of truth for the current workspace's allowed tools and capability notes.
- Routine scoped workspace/browser/computer operations are not automatically per-call approval gated. Current policy returns `requires_approval: []`; provider UI may still ask for confirmation based on its own risk model.
- `.agent/PANIC_STOP` remains an explicit operator stop mechanism for tools covered by the panic policy.

## Provider risk annotations

`server.tool_annotations.mode` controls provider-facing MCP risk hints:

- `honest` (default): read tools are read-only; mutating file tools advertise `destructiveHint: true`; local command/process-style tools advertise destructive + open-world risk.
- `private_high_autonomy`: trusted private lanes may suppress the destructive confirmation hint for write/run tools, but mutations are still reported as non-read-only and run tools remain open-world where appropriate.

Annotations are provider hints, not authorization. Capability policy, auth, path scope, and server-side execution checks remain authoritative.

## Credentials, Git/GitHub, and secret handling

- Git/GitHub credentials are loaded from configured local token files or wrappers and injected only into the child process/auth lane. Do not embed PATs in repository remotes.
- Tools may use protected local credentials when the workspace policy grants that capability, but raw credential values must not be returned visibly unless the operator explicitly requests that exact disclosure/use.
- Audit/result redaction must continue to scrub common credential/token patterns from command/tool output.

## Brokered executors and remote execution

- Brokered executors are optional and must be explicitly configured.
- Worker credentials, executor identity, and allowed executor path are server-side boundaries; do not accept an arbitrary caller-supplied executor path or convert a broker into general remote shell access.
- Machine-admin/estate-admin tools must remain scoped to the configured host/workspace/estate contracts rather than inferring authority from network reachability.

## Audit and retention

- Tool calls are written to the workspace/agent audit stream (normally `.agent/audit/tool_calls.jsonl`).
- HTTP mode records bounded safe request metadata in `.agent/audit/http_requests.jsonl`.
- Audit records must contain operation metadata, status, bounded previews/hashes where useful, and redacted values—not raw bearer tokens, PATs, OAuth tokens, private keys, cookies, or signed secrets.

See `POLICY_MODEL.md`, `API_CAPABILITY_SETS.md`, `AUDIT_RETENTION.md`, and `PRIMITIVE_RUNTIME.md` for the detailed capability, retention, and execution contracts.
