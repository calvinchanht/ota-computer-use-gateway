# Boba Mac CUA Adapter

Boba is the MacBook Air / CUADriver computer-use lane. It is more powerful than the Catalyst browser workspace because it can observe and control the local macOS desktop through CUA Driver.

## Host posture

Current target from Genesis continuity:

```text
host: calvinc@calvins-air
workspace: /Users/calvinc/.openclaw/workspace
OpenClaw session lane: agent:boba:family
CUA binary: /Users/calvinc/.local/bin/cua-driver
CUA app: /Applications/CuaDriverRs.app
```

Do not expose Mac services publicly by default. Prefer Tailscale/SSH and local-only MCP until the scoped gateway path is boring and audited.

## Tool Gateway config

Start from:

```text
config/boba.example.yaml
```

The MVP workspace enables:

- scoped file/context access to `/Users/calvinc/.openclaw/workspace`;
- local command/process primitives;
- screen observation;
- mouse/keyboard control through CUA Driver.

## Cua Driver tools

Boba/Mac computer use is exposed as a scoped Cua Driver proxy, not as gateway semantic wrapper tools. Provider-facing agents should recognize and use Cua Driver directly:

- `cua_driver_status`
- `cua_driver_call`
- `cua_driver_batch`

`cua_driver_call` calls one allowed Cua Driver method with native Cua Driver params. Read-only methods (`check_permissions`, `list_windows`, `get_screen_size`, `get_window_state`, `get_accessibility_tree`, `get_agent_cursor_state`, `screenshot`) require screen policy. Local input/control methods (`click`, `double_click`, `drag`, `hotkey`, `press_key`, `set_value`, `type_text`, `type_text_chars`, `zoom`) require mouse/keyboard policy.

`cua_driver_batch` runs raw Cua Driver command steps sequentially and supports gateway-side `{ "delay_ms": number }` steps. This is transport sequencing only, not a semantic computer-use wrapper.

The gateway provides auth, workspace scoping, policy gates, audit, bounded outputs, and limits. It should not expose wrapper soup such as `computer_click`, `computer_type_text`, `computer_press_key`, or `computer_hotkey` when Cua Driver already provides those capabilities. External/irreversible actions remain stop-gated by policy and bootstrap instructions.

## Safety boundaries

Boba may inspect and perform controlled local scratch actions, but must stop before:

- CAPTCHA, Turnstile, or human verification;
- credential/secret use;
- external messages/email;
- payments, terms acceptance, or irreversible actions;
- destructive file/app operations;
- any Roblox publish/upload/account action.

Roblox Studio should remain later-stage. Prove boring GUI mutation first.

## Current validation snapshot

On 2026-05-30, Genesis verified:

- Boba family routing audit passed for `agent:boba:family`.
- Mac OpenClaw/CUA audit passed: Accessibility and Screen Recording were true; CUA `list_windows` worked; Roblox/Roblox Studio/CUA app were installed.
- Direct CUA Terminal mutation proof succeeded by typing a command into Terminal and reading back `/Users/calvinc/Desktop/boba-cua-terminal-proof.txt`.
- Local Boba Tool Gateway was cloned/built on the Mac and run on `127.0.0.1:8768` with `config/boba.local.yaml`.
- Public-style local MCP tool discovery originally exposed the old computer wrapper tools; the current direction is the Cua Driver proxy surface above.
- Added direct Cua Driver proxy direction so Boba can use the real scoped Cua Driver surface rather than being trapped behind toy wrappers.
- Old `computer_status` reported CUA ready for screen and mouse/keyboard.
- Old `observe_screen` returned screen size and window list; screenshot failed with `screencapture failed for main display`, so screenshot remains a live Mac display/TCC/screencapture blocker.
- Gateway-mediated CUA mutation proof previously succeeded via wrapper tools against Terminal, creating `/Users/calvinc/Desktop/boba-gateway-cua-proof.txt` with the expected marker; future proof should use `cua_driver_call` / `cua_driver_batch`.

## Next steps

1. Convert the temporary local Boba gateway run into a LaunchAgent if/when Calvin wants Boba MCP to stay up.
2. Debug macOS screenshot failure (`screencapture failed for main display`) separately from input control; window listing and keyboard injection already work.
3. Add a provider connector/tunnel only after local Boba MCP acceptance is boring.
4. Continue GUI mutation staging: Terminal proof is green; next target is a harmless Chrome/debug-profile or TextEdit proof with independent readback.
5. Only after boring GUI mutation is reliable, test Roblox Studio with a local-only harmless action.
