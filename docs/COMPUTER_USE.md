# Computer-Use Primitives

The browser layer is Chrome DevTools Protocol (CDP) proxying. It does not expose form/action wrapper tools for browser features that CDP already provides.

## Browser/CDP tools

- `list_browser_profiles` — list configured Chrome/CDP profiles for a workspace.
- `browser_status` — return configured profile metadata and CDP reachability.
- `list_browser_tabs` — list Chrome page targets through the configured debugging port.
- `browser_cdp_browser_call` — call one CDP method on the scoped browser websocket.
- `browser_cdp_browser_batch` — call multiple CDP methods on the scoped browser websocket.
- `browser_cdp_call` — call one CDP method on a scoped page-target websocket.
- `browser_cdp_batch` — call multiple CDP methods on a scoped page-target websocket.

Use CDP directly for browser work, including DOM inspection, snapshots, screenshots, navigation, clicking, typing, file upload flows, form filling, page scripting, tab management, and browser-level operations.

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
