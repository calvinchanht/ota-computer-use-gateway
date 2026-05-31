# Current Task

Validate whether ChatGPT Projects + scoped Gateway API can replace MCP as the primary provider runtime for Mickey.

Current status:

- GitHub issue #12 tracks this validation.
- Mickey Project has been created in ChatGPT.
- Project files/source context work as the agent shell.
- OpenAI Apps/MCP is no longer the preferred Mickey runtime path; the `Mickey` and `Mickey Gateway` app entries were removed to avoid webchat tool confusion.
- The scoped JSON API transport is implemented and deployed for Mickey:
  - `POST /api/v1/tool`
  - `POST /api/v1/batch`
  - `GET /api/v1/runs/{run_id}` for recovery after stream failure
  - `GET|POST /api/v1/debug/request_context`
- API responses now include `api.run_id` and `api.status`; repeated `idempotency_key` calls return the original run.

Next validation is the external bridge/orchestrator path: use the Mickey Project chat for source/context, and call the Gateway JSON API outside OpenAI Apps/MCP.
