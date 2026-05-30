# Skills and Runbooks

Chat-thread agents should accumulate competence. When a workflow becomes repeatable, write it down as a workspace skill instead of rediscovering it in every provider thread.

## Layout

The gateway recognizes both current lightweight workspace layouts:

```text
.agent/skills/<skill>/SKILL.md
.agents/skills/<skill>/SKILL.md
```

Use lowercase `snake-case` or `kebab-case` skill names. A skill directory may also contain helper scripts, examples, fixtures, or notes, but `SKILL.md` is the discoverable entry point.

## Progressive disclosure

Use metadata first, then read the full skill only when relevant:

```text
list_skills
→ choose a relevant skill by name/description
→ read_skill(name)
→ follow SKILL.md instructions and use normal primitives for scripts/files
```

This avoids injecting every runbook into every chat thread.

## Tools

- `list_skills` — lists skill names, roots, paths, descriptions, and byte sizes.
- `read_skill` — reads one `SKILL.md` by validated skill name.

Creating or updating skills is intentionally done with the normal file primitives:

- `write_file`
- `edit_file`
- `apply_patch`
- `write_binary_file` for binary examples/artifacts if needed

## Boundaries

The gateway does not execute skills as a separate privileged plugin system. A skill is workspace knowledge plus optional helper files. Agents still use normal policy-bounded tools for filesystem, command, process, and future computer-use actions.

Future OTA Context Store/Core layers may index, rank, version, or promote skills, but this simple local layout is enough for chat-thread agents to start building reusable memory now.

## Validation

Local primitive smoke exercises skill discovery and on-demand reading:

```bash
npm run smoke:primitives
```
