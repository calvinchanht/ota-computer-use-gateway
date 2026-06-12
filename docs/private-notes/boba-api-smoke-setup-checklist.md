# Boba API Smoke setup checklist

- GPT name: Boba API Smoke
- Visibility: Private only / Only me
- Live URL: `https://chatgpt.com/g/g-6a1e0c014ccc8191abfc2aacbb472213-boba-api-smoke`
- Action schema: `docs/examples/boba-api-action-openapi.yaml`
- Server URL: `https://boba-api.unrealize.com`
- Auth type: Bearer token
- Token source, do not print: `/Users/calvinc/.openclaw-boba-api/secrets/bearer-token` on `calvinc@calvins-air`
- Calvin approval was granted for storing the Boba bearer token in this private ChatGPT Action config.

## Current Boba readiness

Boba API is ready for Roblox Studio computer-use work with these known-good capabilities:

- Authenticated public API endpoint: `https://boba-api.unrealize.com`
- Gateway paths:
  - `/api/v1/tool`
  - `/api/v1/batch`
  - `/api/v1/runs/{run_id}`
- Workspace root: `/` for whole-Mac access
- Boba home/scratch workspace: `/Users/calvinc/.openclaw/workspace`
- Boba startup/context/artifacts: `/Users/calvinc/.openclaw/workspace/.agent`
- Roblox Studio: `/Applications/RobloxStudio.app`
- Screenshot artifacts: `.agent/artifacts/screenshots/...png` (transient; screenshot calls clean managed captures older than 86400s and keep latest 100)
- Cursor fallback: `fallback_position` appears when Cua cursor position is null
- Real Roblox Studio window smoke passed:
  - PID `95098`, window_id `3698`, title `Roblox Studio`, bounds `1440x900`, `is_on_screen:true`
  - `get_window_state` run `824174fb-f495-4d57-9d56-455ccd6742e2` returned `element_count:123`

## Fresh chat startup prompt

```text
You are Boba. Start by calling get_agent_bootstrap, get_tool_profile, and get_workspace_policy with workspace_id=boba. Then verify Roblox Studio readiness using stat_path for Applications/RobloxStudio.app, cua_driver_status, list_windows, and screenshot only if needed. Remember: workspace root is /, but your home/scratch workspace is /Users/calvinc/.openclaw/workspace. If any response has api.status=running, poll get_gateway_run with api.run_id instead of retrying the original command.
```

## First Roblox readiness check

```text
Check whether Roblox Studio is usable. Do not create, save, publish, upload, or modify any project. Use targeted read-only calls: get_agent_bootstrap, stat_path Applications/RobloxStudio.app, cua_driver_status, list_windows, and screenshot if needed. If Roblox Studio has a real on-screen window, call get_window_state with its pid and window_id and summarize the result.
```

## Safety reminder

Boba may operate the local Mac for Calvin's requested task, but must stop before external sends/uploads/forms, payment/account/security settings, terms/CAPTCHA/human verification, destructive deletes, or macOS security prompts unless Calvin explicitly approves that specific action.
