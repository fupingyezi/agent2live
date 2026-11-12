# ADR 0006: Single-user local workspace

Status: accepted

Date: 2026-11-12

## Decision

The first public release is a single-user, local-first desktop workbench.

- One OS user owns one local workspace and one SQLite database.
- Characters, ArtProjects, Assets, PromptVersions, ArtVersions, provider
  connections, backups, and memory spaces are workspace-scoped domain data.
- The local sidecar bearer token protects the local HTTP service from
  unintended local access. It is not a user identity, login session, or
  authorization principal.
- `local-user` is an audit label for the local operator. It is not an account,
  user foreign key, or RBAC role.
- The first release does not include registration, login, password reset,
  OAuth, user profiles, organizations, teams, sharing, collaboration,
  multi-device sync, cloud accounts, or role-based access control.
- The first release does not add a speculative `user_id`, `tenant_id`, or
  account ownership column to domain tables.

## Future Extension

If accounts or sync are added later, they should be introduced as a separate
phase with an explicit workspace/account migration. The existing version model,
content hashes, local domain services, and audit boundaries should remain
valid. Provider secrets remain device-local unless a future security review
explicitly defines a different secret model.

## Consequences

- Phase 0 and Phase 1 can optimize for one local workspace and skip account UI,
  user administration, tenant filtering, and per-user authorization tests.
- A future account system is an extension layer, not a prerequisite for the
  personal workbench MVP.
