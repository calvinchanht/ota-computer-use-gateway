# Security

The server is default-deny and workspace-scoped.

Core rules:

- listen locally only;
- resolve paths after symlinks;
- reject paths outside configured workspaces;
- do not add hidden secret/path deny lists; any future deny list requires Calvin's explicit approval;
- audit every tool call;
- keep mutation tools approval-gated;
- keep screen, mouse, keyboard, arbitrary shell, and delete tools disabled until explicitly enabled.
