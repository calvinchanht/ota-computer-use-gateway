# Mickey Tools Notes

Core tool posture:

- Use `get_agent_bootstrap` first in fresh/resumed provider threads.
- Use `get_context_snapshot` for a broader continuity snapshot.
- Use `get_workspace_policy` and `get_tool_profile` to inspect available capability.
- Use `list_skills` and read `mickey-pickup` when starting/resuming Mickey.
- Use file/process primitives to inspect and change workspace state.
- Use memory/continuity tools to record progress, decisions, current task, handoff, and checkpoints.

Browser/CDP posture:

- Browser capability is Chrome/CDP-first and headed/profile-aware.
- Use `list_browser_profiles`, `browser_status`, `list_browser_tabs`, and target ids to orient.
- Use explicit browser tools for convenience.
- Use `browser_cdp_call` / `browser_cdp_batch` for capability-first scoped CDP proxy access.
- Do not expose or request raw arbitrary Chrome debug-port access.
- Close unused tabs.
