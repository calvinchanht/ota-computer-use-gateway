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

## Computer tools

When running on macOS with `cua-driver` available, Tool Gateway computer tools use CUA Driver:

- `computer_status`
- `observe_screen`
- `computer_click`
- `computer_type_text`
- `computer_press_key`
- `computer_hotkey`
- `computer_cua_call`

`computer_cua_call` is the capability-first CUADriver proxy for allowed CUA tools. Read-only calls (`check_permissions`, `list_windows`, `get_screen_size`, `get_window_state`, `get_accessibility_tree`, `get_agent_cursor_state`, `screenshot`) require screen policy. Mutating calls (`click`, `double_click`, `drag`, `hotkey`, `press_key`, `set_value`, `type_text`, `type_text_chars`, `zoom`) require mouse/keyboard policy.

`observe_screen` returns permissions, screen size, a bounded window list, and a bounded screenshot payload when CUA screenshot succeeds. If macOS `screencapture` fails, the tool returns `screenshot_error` while still returning window state when available.

Mutating computer tools require `allow_mouse_keyboard: true`. They are annotated as non-read-only but non-destructive, matching the OpenClaw-like workflow: routine scoped local operations should not trigger per-call provider confirmation dialogs. External/irreversible actions remain stop-gated by policy and bootstrap instructions.

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
- Public-style local MCP tool discovery exposed the computer tools above.
- Added `computer_cua_call` so Boba can use the real scoped CUADriver surface rather than being trapped behind a tiny toy wrapper.
- `computer_status` reported CUA ready for screen and mouse/keyboard.
- `observe_screen` returned screen size and window list; screenshot failed with `screencapture failed for main display`, so screenshot remains a live Mac display/TCC/screencapture blocker.
- Gateway-mediated CUA mutation proof succeeded via `computer_type_text` + `computer_press_key` against Terminal, creating `/Users/calvinc/Desktop/boba-gateway-cua-proof.txt` with the expected marker.

## Next steps

1. Convert the temporary local Boba gateway run into a LaunchAgent if/when Calvin wants Boba MCP to stay up.
2. Debug macOS screenshot failure (`screencapture failed for main display`) separately from input control; window listing and keyboard injection already work.
3. Add a provider connector/tunnel only after local Boba MCP acceptance is boring.
4. Continue GUI mutation staging: Terminal proof is green; next target is a harmless Chrome/debug-profile or TextEdit proof with independent readback.
5. Only after boring GUI mutation is reliable, test Roblox Studio with a local-only harmless action.
