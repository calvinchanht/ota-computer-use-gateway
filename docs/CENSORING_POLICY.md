# Censoring and child-process environment policy

OTA application-level censoring is compatibility-first by default. The following `security` keys are optional and default to `false`:

```yaml
security:
  conservative_censoring: false
  secret_value_redaction: false
  result_sanitization: false
  secret_content_heuristics: false
  environment_filtering: false
```

`conservative_censoring: true` is the lower-trust umbrella: it enables secret-value redaction, result sanitization, secret-content heuristics, and restrictive child-environment filtering. Individual layers can instead be enabled separately.

Child command environments are authority-sensitive when `environment_filtering` is false. Workspaces with `api_sets.machine_admin: true` or `api_sets.estate_admin: true` inherit the complete OTA host process environment. Ordinary workspaces receive only a non-secret compatibility allowlist: `PATH`/`Path`, `PATHEXT`, `HOME`/`USERPROFILE`, `TEMP`, `TMP`, `LANG`, `LC_ALL`, `SHELL`, `COMSPEC`, `SystemRoot`, and `WINDIR`. Explicit server-side command environment overrides are applied after the base environment. Setting `environment_filtering: true`, or enabling the umbrella, forces the tiny allowlist for every workspace.

`looksSecret()` and related continuity/artifact write heuristics are disabled unless `secret_content_heuristics` (or the umbrella) is enabled. Broad Git/GitHub pattern sanitization, OTA-Memory adapter diagnostics, continuity search/report output, and heuristic secret-value transforms remain disabled unless the relevant result/redaction setting is enabled. One narrow invariant is independent of those switches: credential values that OTA itself reads or derives for Git/GitHub authentication are exact-matched and masked after child execution before result/log display. This does not alter the credential passed to the child and does not censor unrelated token-looking output.

These settings govern OTA application behavior only. Provider, client, MCP-host, operating-system, network, and platform security controls remain independent.
