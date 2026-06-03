# Audit retention

Default operator policy for fast-moving webchat lanes:

- rotate/compress active audit JSONL records after they have been idle for more than 1 day;
- prune compressed audit archives older than 5 days;
- keep audit logs metadata-first, especially for screenshot/computer-use flows;
- do not store raw screenshot pixels in audit JSONL.

The retention helper is intentionally explicit and workspace-agent-dir scoped:

```bash
node scripts/audit-retention.mjs /path/to/workspace/.agent/audit
```

Defaults can be overridden:

```bash
OTA_AUDIT_ROTATE_AFTER_DAYS=1 OTA_AUDIT_PRUNE_ARCHIVES_AFTER_DAYS=5 \
  node scripts/audit-retention.mjs /path/to/workspace/.agent/audit
```

The script compresses these active audit files into `.zip` archives under `audit/archive/` and truncates the active file after successful compression:

- `tool_calls.jsonl`
- `http_requests.jsonl`

Screenshot/image artifacts are handled separately by the Cua screenshot artifact cleanup path. Screenshot audit entries should retain only metadata such as tool name, run id, dimensions, artifact path/id, and timing.
