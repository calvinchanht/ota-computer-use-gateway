# Computer-Use Primitives

Issue #6 adds provider-neutral browser/computer-use primitives in small, safe layers. The first layer establishes the MCP surface and `observe_after` convention before wiring platform-specific adapters.

## Current tools

- `list_browser_profiles` — lists configured headed Chrome/CDP profiles for a workspace.
- `browser_status` — returns selected profile metadata, CDP endpoint/reachability, and tab hygiene reminder.
- `list_browser_tabs` — proxies Chrome CDP `/json/list` and returns page targets/tabs.
- `open_browser_tab` — opens a URL through Chrome CDP `/json/new`, gated by `allow_mouse_keyboard`, with optional `observe_after.tabs` feedback.
- `activate_browser_tab` — focuses an existing Chrome target through CDP `/json/activate/<target_id>`.
- `close_browser_tab` — closes an existing Chrome target through CDP `/json/close/<target_id>`.
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
