# Computer-Use Primitives

Issue #6 adds provider-neutral browser/computer-use primitives in small, safe layers. The first layer establishes the MCP surface and `observe_after` convention before wiring platform-specific adapters.

## Current tools

- `list_browser_profiles` — lists configured headed Chrome/CDP profiles for a workspace.
- `browser_status` — returns selected profile metadata, CDP endpoint/reachability, and tab hygiene reminder.
- `list_browser_tabs` — proxies Chrome CDP `/json/list` and returns page targets/tabs, including stable `key` values when assigned.
- `browser_tab_info` — returns metadata for one Chrome target/tab by raw id or stable tab key.
- `browser_tab_screenshot` — captures a bounded base64 screenshot from one Chrome target/tab through its CDP websocket; gated by `allow_screen`.
- `browser_tab_snapshot` — captures a bounded JSON DOM snapshot from one Chrome target/tab through `DOMSnapshot.captureSnapshot`; gated by `allow_screen`.
- `open_browser_tab` — opens a URL through Chrome CDP `/json/new`, gated by `allow_mouse_keyboard`, with optional `tab_key` assignment and `observe_after.tabs` feedback.
- `navigate_browser_tab` — navigates an existing Chrome target/tab through `Page.navigate`, gated by `allow_mouse_keyboard`, with optional `observe_after.tabs` feedback. `target_id` may be a raw Chrome target id or assigned stable tab key.
- `click_browser_tab` — dispatches a left mouse click at viewport coordinates through `Input.dispatchMouseEvent`, gated by `allow_mouse_keyboard`, with optional `observe_after.tabs` feedback. `target_id` may be a raw id or stable key.
- `type_browser_tab` — inserts bounded text into the focused element through `Input.insertText`, gated by `allow_mouse_keyboard`, with optional `observe_after.tabs` feedback. `target_id` may be a raw id or stable key.
- `fill_browser_tab_field` — sets a bounded value on an input/textarea selected by CSS selector through scoped `Runtime.evaluate`, dispatching `input` and `change` events; gated by `allow_mouse_keyboard`, with optional `observe_after.tabs` feedback. `target_id` may be a raw id or stable key.
- `select_browser_tab_option` — selects a native `<select>` option by value or exact visible text through scoped `Runtime.evaluate`, dispatching `input` and `change` events; gated by `allow_mouse_keyboard`, with optional `observe_after.tabs` feedback. `target_id` may be a raw id or stable key.
- `press_browser_tab_key` — dispatches a bounded keyboard key press/release through `Input.dispatchKeyEvent`, gated by `allow_mouse_keyboard`, with optional `observe_after.tabs` feedback. `target_id` may be a raw id or stable key.
- `scroll_browser_tab` — dispatches a bounded mouse-wheel scroll through `Input.dispatchMouseEvent`, gated by `allow_mouse_keyboard`, with optional `observe_after.tabs` feedback. `target_id` may be a raw id or stable key.
- `browser_cdp_call` — proxies one Chrome DevTools Protocol method through a scoped target websocket; gated by `allow_mouse_keyboard`. `target_id` may be a raw id or stable key.
- `browser_cdp_batch` — proxies up to 20 Chrome DevTools Protocol calls through a scoped target websocket; gated by `allow_mouse_keyboard`. `target_id` may be a raw id or stable key.
- `activate_browser_tab` — focuses an existing Chrome target through CDP `/json/activate/<target_id>`. `target_id` may be a raw id or stable key.
- `close_browser_tab` — closes an existing Chrome target through CDP `/json/close/<target_id>`. `target_id` may be a raw id or stable key.
- `computer_status` — returns workspace computer-use capability posture and adapter status.
- `observe_screen` — returns the screen observation shape when `allow_screen` is enabled. Platform adapters will fill screenshot/window-tree data in later slices.

## Browser profile defaults

Browser tools are Chrome/CDP-first, not Playwright-first. The default posture is headed Chrome attached through a debugging port.

Workspace config can declare profiles:

```yaml
browser:
  profiles:
    - label: "mickey"
      user_data_dir: "/home/mickey/.config/google-chrome-mickey"
      cdp_host: "127.0.0.1"
      cdp_port: 9222
      display: ":20"
      headed: true
      default: true
      launch: false
```

If no profile is configured, the gateway synthesizes a default profile whose label is the workspace/agent id. This avoids vague labels like `default` and helps agents stay aware of which browser profile they are using.

Browser status/profile responses include:

```json
{ "reminder": "Close unused tabs." }
```

## Browser attention states

Browser tab summaries include an `attention` object so provider-thread agents have a standard readiness signal:

```json
{
  "attention": {
    "state": "ready",
    "guidance": "No obvious login, CAPTCHA, or verification blocker detected from tab metadata."
  }
}
```

Current states:

- `ready` — no obvious blocker was detected from tab metadata.
- `needs_login` — title/URL suggests login, SSO, OAuth, or authentication. Stop if credentials, account selection, 2FA, or secret use is required.
- `needs_captcha` — title/URL suggests CAPTCHA, Turnstile, Cloudflare challenge, or human verification. Stop and ask Calvin; do not bypass or automate it.

This is intentionally conservative and metadata-based for now. Later slices can add DOM/modal detection, explicit approval states, and richer recovery hints.

## Stable browser tab keys

Provider chat threads can assign a durable, human-readable `tab_key` when opening a tab:

```json
{
  "workspace_id": "catalyst",
  "url": "https://example.com/jobs",
  "tab_key": "job-search-main"
}
```

The gateway stores key bindings under the workspace `.agent/browser-tabs.json`. Later browser tools may pass that stable key anywhere `target_id` is accepted:

```json
{
  "workspace_id": "catalyst",
  "target_id": "job-search-main",
  "url": "https://example.com/jobs?q=designer"
}
```

Responses still expose the raw Chrome target id for debugging and CDP-level work, but stable keys are preferred for long-running provider-thread workflows.

## `observe_after` convention

UI-mutating actions should accept an optional post-action observation request:

```json
{
  "observe_after": {
    "delay_ms": 500,
    "screenshot": true,
    "include_window_tree": true,
    "tabs": true
  }
}
```

The gateway clamps delay values to a small bounded range. If screenshot or window-tree feedback is requested, the action should return the normal action result plus an observation payload.

## Safety model

- `computer_status` is always read-only.
- `observe_screen` is only advertised when a workspace enables `allow_screen`.
- Mouse/keyboard tools are not advertised until a concrete adapter and explicit `allow_mouse_keyboard` policy path exist.
- Semantic/browser actions should be preferred over raw coordinates where possible.
- Raw coordinate actions should remain more tightly gated and audited.

## Deferred adapters

The current slice does not yet capture pixels or control input. Future slices should add platform/browser adapters behind the same tool shape, for example:

- browser/CDP observe/navigation/action primitives;
- Linux screenshot/window-tree adapter;
- macOS/Boba/CuaDriver computer adapter;
- `observe_after` support on click/type/hotkey/scroll actions.
