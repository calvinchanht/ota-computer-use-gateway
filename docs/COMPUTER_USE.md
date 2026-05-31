# Computer-Use Primitives

The browser layer is Chrome DevTools Protocol (CDP) proxying. It does not expose form/action wrapper tools for browser features that CDP already provides.

## Browser/CDP tools

- `list_browser_profiles` — list configured Chrome/CDP profiles for a workspace.
- `browser_status` — return configured profile metadata and CDP reachability.
- `list_browser_tabs` — list Chrome page targets through the configured debugging port.
- `browser_cdp_browser_call` — call one CDP method on the scoped browser websocket.
- `browser_cdp_browser_batch` — send a sequence of raw CDP command steps to the scoped browser websocket; also supports gateway-side `{ "delay_ms": number }` sequencing steps.
- `browser_cdp_call` — call one CDP method on a scoped page-target websocket.
- `browser_cdp_batch` — send a sequence of raw CDP command steps to a scoped page-target websocket; also supports gateway-side `{ "delay_ms": number }` steps and command-level `wait_for: "page_load" | "dom_content_loaded"`.

Use CDP directly for browser work, including DOM inspection, snapshots, screenshots, navigation, clicking, typing, file upload flows, form filling, page scripting, tab management, and browser-level operations. Batch tools are transport sequencers for raw CDP commands; they do not invent browser actions.

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

## Non-CDP computer tools

These remain because they are not browser-CDP features:

- `computer_status`
- `observe_screen`
- `computer_click`
- `computer_type_text`
- `computer_press_key`
- `computer_hotkey`
- `computer_cua_call`

Use these only for OS-level computer use outside Chrome/CDP.

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
