# Retention Operations

OTA hosts should keep runtime retention as script/timer work, not provider-loop work.

## Telegram / Threaddex Logs

Default policy:

- Telegram polling and Threaddex runtime logs have a 1 hour TTL.
- Cleanup cadence should be 10-15 minutes.
- The script deletes only log-like files (`.log`, `.out`, `.err`, `.jsonl`) under explicit log roots.
- The script does not touch job stores, repo files, deployment directories, or app code.

Command:

```bash
node scripts/prune-runtime-logs.mjs --root /path/to/logs --ttl-hours 1 --watch --apply
```

For a one-shot dry run, omit `--apply`.

## Deployment Backups

Default policy:

- Keep the current active deployment target.
- Keep at most one previous backup for the same agent/service.
- Delete older inactive backups for that same agent/service.
- Abort if the active target cannot be determined.

Command:

```bash
node scripts/prune-deployment-backups.mjs \
  --root /path/to/deployments \
  --agent genesis \
  --active-symlink /path/to/current-genesis \
  --keep-previous 1 \
  --apply
```

Use `--active-path` instead of `--active-symlink` when the active deployment path is already known.

## Safety Contract

These scripts are retention helpers only. They must not update Paperclip, OpenClaw, OTA, Threaddex, or provider dependencies. They should be installed under host-local timers or explicit maintenance commands, and their JSON output should be preserved in host maintenance logs.
