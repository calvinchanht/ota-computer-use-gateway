# Security

The server is default-deny and workspace-scoped.

Core rules:

- listen locally only;
- resolve paths after symlinks;
- reject paths outside configured workspaces;
- deny obvious secret files;
- audit every tool call;
- keep mutation tools approval-gated;
- keep screen, mouse, keyboard, arbitrary shell, and delete tools disabled until explicitly enabled.
