# Code style

This repo favors small, readable modules.

Guidelines:

- Keep functions around 30 lines or fewer.
- Keep script/source files under 1000 lines.
- Split modules by responsibility instead of hiding complexity in giant helpers.
- Prefer explicit types and small pure helpers.
- Use durable state transitions instead of ad-hoc side effects.
- Do not store or log raw secrets, tokens, cookies, private keys, or auth headers.

Checked scope:

- Production source under `src/`.
- Operational helper scripts under `scripts/`.
- Real command/action handlers, parsing, validation, IO, and business logic.

Excluded from the line-limit checker:

- Test files and test directories.
- Build output, coverage output, dependencies, and declaration files.
- Generated or manifest-like assets such as generated schemas and Custom GPT project files.
- Pure declarative command-registration containers that mainly declare command wiring. The action handlers themselves must stay small or delegate to named helpers.
- Pure embedded browser/provider script factories that return a template-string script for execution inside a remote page. Keep the host-side wrapper small; split the embedded script if it becomes difficult to reason about.

The line limits are engineering guardrails, not a license to obscure code. Refactor honestly when code grows.
