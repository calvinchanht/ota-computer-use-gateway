# Computer-Use Primitives

Issue #6 adds provider-neutral browser/computer-use primitives in small, safe layers. The first layer establishes the MCP surface and `observe_after` convention before wiring platform-specific adapters.

## Current tools

- `computer_status` — returns workspace computer-use capability posture and adapter status.
- `observe_screen` — returns the screen observation shape when `allow_screen` is enabled. Platform adapters will fill screenshot/window-tree data in later slices.

## `observe_after` convention

UI-mutating actions should accept an optional post-action observation request:

```json
{
  "observe_after": {
    "delay_ms": 500,
    "screenshot": true,
    "include_window_tree": true
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
