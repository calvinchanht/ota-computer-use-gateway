# Computer-Use Primitives

Browser access is direct Chrome DevTools Protocol (CDP) proxying. It does not expose form/action wrapper tools for browser features that CDP already provides.

## Browser/CDP tools

- `list_browser_profiles` — list configured Chrome/CDP profiles for a workspace.
- `browser_status` — return configured profile metadata and CDP reachability.
- `list_browser_tabs` — list Chrome page targets through the configured debugging port.
- `browser_cdp_browser_call` — call one CDP method on the scoped browser websocket.
- `browser_cdp_browser_batch` — send a sequence of raw CDP command steps to the scoped browser websocket; also supports gateway-side `{ "delay_ms": number }` sequencing steps.
- `browser_cdp_call` — call one CDP method on a scoped page-target websocket.
- `browser_cdp_batch` — send a sequence of raw CDP command steps to a scoped page-target websocket; also supports gateway-side `{ "delay_ms": number }` steps and command-level `wait_for: "page_load" | "dom_content_loaded"`.

Use CDP directly for browser work, including DOM inspection, snapshots, screenshots, navigation, clicking, typing, file upload flows, form filling, page scripting, tab management, and browser-level operations. Batch tools are transport sequencers for raw CDP commands; they do not invent browser actions. Do not create observer/read-only fallback behavior: browser access is either direct CDP ON or explicit OFF/error.

Examples of CDP methods provider-thread agents may use directly:

- `Runtime.evaluate`
- `DOMSnapshot.captureSnapshot`
- `Page.captureScreenshot`
- `Page.navigate`
- `Input.dispatchMouseEvent`
- `Input.dispatchKeyEvent`
- `Input.insertText`
- `Target.createTarget`
- `Target.activateTarget`
- `Target.closeTarget`
- `Browser.getVersion`

The gateway scopes access to the configured profile/target and keeps it behind MCP auth/policy. It does not expose a naked remote debugging port publicly.

## Mac/Cua Driver tools

The Mac computer-use layer is Cua Driver proxying. It does not expose gateway semantic wrappers for Cua Driver features. Use Cua Driver method names and params directly.

- `cua_driver_status` — return Cua Driver availability, permissions, adapter path, allowed methods, and Mac computer-use posture.
- `computer_screen_click` — click global Mac screen coordinates without passing a pid; preferred for screenshot-coordinate interactions.
- `computer_window_click` — click in a known app/window/process context using a current pid from `list_windows` / `get_window_state`.
- `cua_driver_call` — call one raw Cua Driver method through the scoped gateway.
- `cua_driver_batch` — send a sequence of raw Cua Driver command steps; also supports gateway-side `{ "delay_ms": number }` sequencing steps.

The gateway provides auth, workspace scoping, policy checks, audit, limits, and bounded output around Cua Driver. It does not present a fake higher-level “safer” computer abstraction.

## Windows computer-use tools

The Windows computer-use layer is a native Windows adapter. It uses monitor capture, Microsoft UI Automation, Win32 window/input APIs, clipboard APIs, and app launch through the local host. It is designed to empower trusted webchat agents, not to handicap them.

Enable it explicitly per workspace. The `api_sets.computer_windows` macro grants the complete Windows computer-use surface:

```yaml
api_sets:
  computer_windows: true
windows_computer:
  enabled: true
  allow_screenshot: true
  allow_uia_tree: true
  allow_mouse: true
  allow_keyboard: true
  allow_clipboard: true
  allow_window_management: true
  allow_app_launch: true
  allow_process_attach: true
  allow_multi_monitor: true
```

Tools:

- `windows_computer_status` — report host/platform and configured Windows authority.
- `windows_list_monitors` — list monitor bounds, working areas, and primary flags.
- `windows_screenshot` — capture `primary`, `all`, or a monitor index and save PNG/WebP artifacts with provider-fetchable URL metadata.
- `windows_uia_tree` — return a bounded Microsoft UI Automation tree snapshot.
- `windows_list_windows` — list visible top-level windows with hwnd, title, pid, and bounds.
- `windows_focus_window` — focus a top-level window by hwnd.
- `windows_launch_app` — launch a local executable or application path with optional args/cwd.
- `windows_mouse_move`, `windows_click`, `windows_double_click`, `windows_drag`, `windows_scroll` — screen-coordinate mouse control.
- `windows_window_mouse_move`, `windows_window_click`, `windows_window_double_click`, `windows_window_drag`, `windows_window_scroll` — window-local mouse control for a known top-level hwnd.
- `windows_type_text`, `windows_key`, `windows_hotkey` — keyboard control.
- `windows_clipboard_get`, `windows_clipboard_set` — clipboard text.
- `windows_batch` — sequence common Windows input actions plus delay steps.

Authority is adjustable, but capability is not intentionally weakened. A trusted local webchat agent can be granted full screen, mouse, keyboard, clipboard, multi-monitor, window-management, and app-launch rights. Less trusted agents can receive a smaller subset from the same contract.

Screen mouse coordinates are Windows virtual-screen coordinates. For multi-monitor work, call `windows_list_monitors` first and choose either an explicit monitor for screenshots or absolute screen coordinates for input; secondary monitors may have negative `x`/`y` origins.

Window mouse coordinates require a current `hwnd` from `windows_list_windows`. Use `coordinate_space: "client"` for app-content coordinates, or `coordinate_space: "window"` for full window-frame coordinates. Window mouse tools convert those coordinates with native Win32 APIs and then send the same underlying screen mouse input. They default to focusing the target window except `windows_window_mouse_move`, whose default is hover-only `focus: false`.

Screenshot capture stores a full PNG artifact and a WebP preview artifact under `.agent/artifacts/windows-screenshots/`, but those image paths and signed URLs are internal to the OTA -> Threaddex visual-followup handoff. The `windows_screenshot` response must not expose local paths, `artifact`, `preview`, `full`, `readable_url`, `image_web_url`, or `web_url` as competing agent-facing visual sources.

For webchat visual inspection, call `windows_screenshot` with the active Threaddex job id:

```json
{
  "workspace_id": "anna",
  "monitor": "primary",
  "visual_followup": {
    "job_id": "job_..."
  }
}
```

When the Threaddex follow-up endpoint is configured, the gateway posts the screenshot readable URL back to the active job as a visible follow-up prompt. The action response returns only the capture metadata and `visual_followup` polling contract. The webchat agent must poll `visual_followup.status_url` until `sent_to_provider` is true before claiming visual inspection. If `visual_followup.job_id` is omitted, the screenshot is still captured, but `visual_followup.state` is `not_requested`.

App launch is first-class because desktop development workflows, such as Roblox Studio work, require starting and controlling non-browser applications.

For a non-screenshot validation lane, enable only the required rights instead of using that full macro:

```yaml
windows_computer:
  enabled: true
  allow_screenshot: false
  allow_uia_tree: true
  allow_mouse: false
  allow_keyboard: false
  allow_clipboard: false
  allow_window_management: true
  allow_app_launch: true
  allow_process_attach: false
  allow_multi_monitor: true
```

Run the local HTTP smoke with:

```sh
npm run smoke:windows-computer
```

That smoke intentionally avoids `windows_screenshot` and screenshot/image URL serving. It verifies the provider-facing MCP/HTTP contract for monitor discovery, window listing, UI Automation tree reads, and safe app launch.

## Browser profile defaults

Workspace config can declare profiles:

```yaml
browser:
  profiles:
    - label: "catalyst"
      user_data_dir: "/path/to/profile"
      cdp_host: "127.0.0.1"
      cdp_port: 9222
      display: ":20"
      headed: true
      default: true
      launch: false
```

If no profile is configured, the gateway synthesizes a default profile whose label is the workspace/agent id.


## Batch sequencing

`browser_cdp_batch` and `browser_cdp_browser_batch` run steps sequentially. They do not fire all commands at once.

Raw CDP command step:

```json
{ "method": "Runtime.evaluate", "params": { "expression": "document.title", "returnByValue": true } }
```

Delay step:

```json
{ "delay_ms": 500 }
```

Page-target command step with load wait:

```json
{
  "method": "Page.navigate",
  "params": { "url": "https://example.com" },
  "wait_for": "page_load",
  "timeout_ms": 15000
}
```

Supported page-target waits:

- `page_load` → waits for `Page.loadEventFired`
- `dom_content_loaded` → waits for `Page.domContentEventFired`

`wait_for` is only supported by `browser_cdp_batch`, because those events belong to page targets. `browser_cdp_browser_batch` supports raw CDP command steps and delay steps only.


## Cua Driver batch sequencing

`cua_driver_batch` runs steps sequentially. It does not fire all commands at once.

Raw Cua Driver command step:

```json
{ "method": "list_windows", "params": {} }
```

Delay step:

```json
{ "delay_ms": 500 }
```

Example:

```json
{
  "workspace_id": "boba",
  "calls": [
    { "method": "check_permissions", "params": {} },
    { "delay_ms": 500 },
    { "method": "list_windows", "params": {} }
  ]
}
```

Read-only Cua Driver methods require screen policy. Local input/control methods require mouse/keyboard policy.
