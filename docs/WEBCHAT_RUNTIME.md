# Webchat runtime docs

Use these docs for Custom GPT / webchat lanes:

- `WEBCHAT_CUSTOM_GPT_SETUP.md` — safe GPT editor setup checklist and instructions template.
- `WEBCHAT_ACTION_SCHEMA_GUIDE.md` — compact Action schema guidance.
- `WEBCHAT_SMOKE_PROMPTS.md` — standard smoke prompts by lane type.
- `POLICY_MODEL.md` — capability-set policy model; webchat agents should not be weaker than OpenClaw agents when capabilities are enabled.
- `AUDIT_RETENTION.md` — audit zip/prune defaults and screenshot metadata policy.
- `examples/*-api-action-openapi.yaml` — lane-specific Action schemas.

Private implementation notes and deployment-specific credential locations belong under private continuity/runbooks or `docs/private-notes/`, not in GPT editor instructions.

## Genesis lane note — 2026-07-01

Current Webchat Genesis should be treated as a Threaddex + OTA lane, not as a normal OpenClaw gateway lane. OTA provides the scoped capability surface for `genesis-api.unrealize.com`: workspace files, browser/computer access, machine-admin and estate-admin operations, GitHub lane, action schemas, bounded output, audit, and redaction. Threaddex provides the job lifecycle surface: `getJob`, `deliverJobProgress`, `deliverJob`, continuation, schedules, agent messages, Telegram ingress/delivery, and thread anchors.

Do not document `openclaw-gateway-genesis-gateway.service`, `genesis-proxy/nemotron-3-ultra-550b-a55b`, or CLIProxyAPI `127.0.0.1:18318` as the current Webchat Genesis runtime unless a fresh operator/runtime check proves a deliberate rollback. Those names are historical/break-glass context from the OpenClaw recovery lane. For current work, keep OTA capability docs separate from Threaddex job lifecycle docs and route job progress/final output through the native Threaddex operations.
