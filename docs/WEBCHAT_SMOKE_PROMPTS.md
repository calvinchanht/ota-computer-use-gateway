# Webchat smoke prompts

These prompts are safe starting points for private Custom GPT lanes. Replace `<workspace_id>` and agent-specific details before use.

## Workspace-only smoke

```text
Run a read-only workspace smoke. Use the configured Action with workspace_id=<workspace_id>. Call get_tool_profile, get_workspace_policy, get_agent_bootstrap, workspace_inventory, and git_status. Summarize the enabled capability sets, workspace root posture, and whether bounded run_command is exposed. Do not modify anything.
```

Optional bounded command smoke after read-only passes:

```text
Run a harmless bounded workspace command smoke for workspace_id=<workspace_id>: use run_command to execute python3 -c "print('workspace_command_ok')" or an equivalent local command. Do not write files or change state. Report exit code and stdout only.
```

## Workspace + browser smoke

```text
Run a read-only workspace+browser smoke. Use the configured Action with workspace_id=<workspace_id>. Call get_workspace_policy and list_browser_profiles. Then call browser_status for the default profile if available. Summarize whether workspace/browser are enabled and list browser profile labels, CDP ports, and default profile. Do not click, type, upload, submit forms, or change tabs unless needed for read-only status.
```

Optional tab visibility smoke:

```text
List browser tabs for workspace_id=<workspace_id> using the default browser profile. Use include_urls=false unless Calvin asks for URLs. Summarize tab titles and target ids only.
```

## Computer/Cua smoke

```text
Run a read-only computer/Cua smoke for workspace_id=<workspace_id>. Call get_workspace_policy, cua_driver_status, cua_driver_call check_permissions, cua_driver_call get_screen_size, and cua_driver_call list_windows. If any response is async/running, poll get_gateway_run with the run id. Do not click, type, upload, save, submit forms, or change windows. Summarize permissions, screen size, and the most relevant visible windows.
```

Optional screenshot smoke:

```text
Capture one screenshot for workspace_id=<workspace_id> only if screen recording permission is already granted. Confirm the result includes a full PNG artifact and a default half-size WebP preview at quality 85. Fetch no image unless needed. Do not expose raw image bytes in chat.
```

Optional window-state smoke:

```text
From list_windows, pick one clearly relevant on-screen app window. Call get_window_state with its pid and window_id. Summarize pid, window_id, element_count, screenshot dimensions if present, and whether a tree_markdown_artifact URL was returned. Do not interact with the UI.
```

## Genesis/control-plane smoke

```text
Run a read-only estate control-plane smoke. Call estate_bootstrap, estate_overview, and get_tool_profile. Summarize available control-plane report tools and safety posture. Do not run commands, mutate files, restart services, or expose secrets.
```

## Resume/checkpoint prompt

```text
Resume this lane from continuity. First call get_agent_bootstrap, get_context_snapshot, and get_workspace_policy for workspace_id=<workspace_id>. Then summarize current task, recent decisions, enabled capabilities, and the safest next step. Do not perform mutations until Calvin confirms the next workflow.
```
