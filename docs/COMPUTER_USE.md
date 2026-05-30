# Computer-Use Primitives

Issue #6 adds provider-neutral browser/computer-use primitives in small, safe layers. The first layer establishes the MCP surface and `observe_after` convention before wiring platform-specific adapters.

## CDP-first capability posture

The browser layer is Chrome/CDP-first. The core capability is the scoped debugging-port proxy:

- profile/target discovery through the configured Chrome debugging port;
- target operations such as open, activate, close, and list through Chrome `/json/*` endpoints;
- browser-level websocket control through `browser_cdp_browser_call` and `browser_cdp_browser_batch`;
- page-target websocket control through `browser_cdp_call` and `browser_cdp_batch`.

Provider-thread agents can use `Runtime.evaluate`, `DOMSnapshot.captureSnapshot`, `Input.dispatchMouseEvent`, `Input.dispatchKeyEvent`, `Page.navigate`, and other CDP methods through that scoped proxy. That is enough for DOM inspection, page scripting, button clicks, keyboard input, navigation, and custom browser automation inside the selected page target.

The explicit action/form tools below are convenience wrappers only. They are not the architecture, and near-term work should not keep adding per-field wrappers unless a real provider-thread usability gap appears. If a capability is missing, prefer extending the scoped CDP proxy surface over building narrow browser sugar.

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
- `submit_browser_tab_form` — submits a native form selected by CSS selector, or the closest parent form for a selected element, through scoped `Runtime.evaluate`; gated by `allow_mouse_keyboard`, with optional `observe_after.tabs` feedback. External job submissions and irreversible actions still require Calvin approval by policy.
- `press_browser_tab_key` — dispatches a bounded keyboard key press/release through `Input.dispatchKeyEvent`, gated by `allow_mouse_keyboard`, with optional `observe_after.tabs` feedback. `target_id` may be a raw id or stable key.
- `scroll_browser_tab` — dispatches a bounded mouse-wheel scroll through `Input.dispatchMouseEvent`, gated by `allow_mouse_keyboard`, with optional `observe_after.tabs` feedback. `target_id` may be a raw id or stable key.
- `browser_cdp_browser_call` — proxies one Chrome DevTools Protocol method through the scoped browser websocket for a configured profile; gated by `allow_mouse_keyboard`.
- `browser_cdp_browser_batch` — proxies up to 20 Chrome DevTools Protocol calls through the scoped browser websocket for a configured profile; gated by `allow_mouse_keyboard`.
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
- `observe_screen`, screenshots, and DOM snapshots are only advertised when a workspace enables `allow_screen`.
- Browser mutation and scoped CDP tools are only advertised when a workspace enables `allow_mouse_keyboard`.
- Public ingress should keep origin services bound to loopback and require bearer auth; do not expose a naked Chrome debugging port.
- CAPTCHA, Turnstile, human verification, credentials, account creation, uploads, external messages, job submission, payments, terms acceptance, and irreversible external actions remain Calvin-approved workflow boundaries.

The browser layer should otherwise remain capability-first, like an OpenClaw agent. Do not add extra browser-protection layers unless a concrete project requirement appears.

## Deferred adapters

Future slices can add platform/browser adapters behind the same capability-first shape, for example:

- browser-level CDP proxying if page-target websocket scope is not enough;
- Linux screenshot/window-tree adapter;
- macOS/Boba/CuaDriver computer adapter.
