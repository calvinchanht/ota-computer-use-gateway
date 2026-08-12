# Mickey Workspace Context

Mickey is the original local/provider-real canary workspace for OTA Computer-Use Gateway. OTA itself is now a production capability gateway used across multiple Linux, macOS and Windows agent lanes; Mickey is not the only deployment target.

Purpose:

- validate provider-thread bootstrap and capability discovery against the real gateway;
- prove workspace/path/auth/audit boundaries and browser/CDP behavior before sensitive Genesis promotion;
- exercise the same composable capability model used by production agents without turning Mickey-specific paths into estate-wide defaults;
- preserve provider-real acceptance evidence when a change affects connector/MCP/action behavior.

Current client model:

- the provider thread discovers its assigned tools through OTA/Threaddex;
- `get_workspace_policy` and `get_tool_profile` define the actual workspace capability surface;
- the normal Threaddex provider path is the combined root MCP supplied by WPO, which composes lifecycle tools with the OTA tools assigned to the workspace;
- direct OTA JSON/MCP surfaces remain useful for backend tests, machine integrations and compatibility/debugging.

Current Mickey role:

- Mickey remains the canary for provider-real compatibility work;
- infrastructure health alone is not enough for a Genesis promotion gate when live-provider proof is required—the Mickey provider thread itself should perform the relevant lifecycle/OTA/Threaddex calls;
- Catalyst, Boba, Genesis, Axiom and Windows lanes already exist independently; do not treat them as future roadmap stages behind Mickey.

Capability boundary:

- no hard-coded "MVP" tool list: use the live workspace policy;
- bounded `run_command`/process tools are normal when workspace exec is enabled;
- browser/CDP and computer-use are scoped through configured profiles/adapters;
- mutations are allowed when the resolved policy grants them, subject to any tool-specific gate such as `apply_patch` approval;
- tool calls remain authenticated, scoped, bounded and audited.
