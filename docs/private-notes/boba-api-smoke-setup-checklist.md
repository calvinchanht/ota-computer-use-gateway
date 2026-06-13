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

## Boba CustomGPT editor control discipline

When updating the Boba CustomGPT through the ChatGPT UI, do **not** guess editor/config/about URLs and do **not** open multiple CDP tabs.

Required tab discipline:

1. Use the existing BobaChat CDP profile on `127.0.0.1:33388`.
2. Before editing, inspect `/json/list` and ensure there is exactly one real `chatgpt.com` page tab for the BobaChat profile.
3. If stale duplicate ChatGPT tabs exist from previous work, close them first with CDP, keeping only the intended Boba tab.
4. Do not create new tabs for guessed URLs. Navigate the single existing tab only when explicitly needed.

Required normal UI path:

1. Open/select **Boba API Smoke** from the ChatGPT sidebar GPT list.
2. On the Boba CustomGPT screen, open the **Boba API Smoke** dropdown/menu.
3. Click **Edit GPT**.
4. Use the builder UI to update Instructions / Actions / Capabilities.
5. Click **Update** and verify the backend `version` and `live_version` advanced.

Required capability checklist for Boba CustomGPT:

- Web Search: checked.
- Image Generation: checked.
- Code Interpreter & Data Analysis: checked.
- The Boba Gateway Action schema must include workspace, browser, computer-use, and machine-admin tools.
- The Boba Gateway Action schema must not include Genesis estate-admin tools.

After updating, verify:

- Only one BobaChat `chatgpt.com` CDP page tab remains.
- The live CustomGPT instructions mention Boba Threaddex, `estate_admin: false`, and the current runtime paths.
- The live action schema includes machine-admin tools such as `run_configured_command`, `start_process`, `stop_process`, and `browser_tail`.
- The live action schema does not include `genesis_estate_overview` or `genesis_safe_diagnostic`.


## Boba drive access posture

Boba is intended to manage projects across the whole Mac drive. Do not narrow Boba instructions to only `/Users/calvinc/threaddex-boba`, `/Users/calvinc/webchat-provider-orchestrator`, or `/Users/calvinc/ota-computer-use-gateway`. Those are key runtime paths, not the full allowed workspace.

Boba gateway workspace root is `/`, so filesystem tools may use either absolute Mac paths, e.g. `/Users/calvinc/project`, or workspace-relative root paths, e.g. `Users/calvinc/project`. Secret and credential paths remain protected by gateway policy and must not be revealed.


## Boba unrestricted machine-admin posture

Boba is a Mac machine-admin agent. The Boba OTA gateway config should grant full workspace, browser, computer-use, and machine-admin rights over the configured Mac workspace root `/`. Do not add path deny-globs or secret-directory denial to Boba's local gateway config unless Calvin explicitly asks for it. Boba may access local credential/PAT/token files that Calvin provisioned for authorized machine-admin operations.

Telegram polling should be configured as continuous long polling, not sparse polling. Use `poll-host-telegram-once --timeout-seconds 50` under launchd with a short `StartInterval` such as 3 seconds so launchd relaunches immediately after each long poll returns.
