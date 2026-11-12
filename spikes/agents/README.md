# Agent control-plane probes

Phase 0 only. These are not production agent wrappers.

## Run

```bash
pnpm probe:codex
pnpm probe:claude
```

Reports are written to `docs/plans/evidence/phase0/G0-AGENT/`, which is ignored
by git. Exit codes: `0` pass, `1` fail, `2` blocked.

## Blocked is not pass

- Codex needs `codex-cli` installed and `codex login status` to report a login.
  Without it the report is `blocked:CODEX_NOT_LOGGED_IN`.
- Claude needs `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN`.
  Without it the report is `blocked:CLAUDE_AUTH_MISSING`.
- A blocked probe never retries automatically and never fabricates a turn.

## Permission boundary

The probes respond to approvals only for the literal commands
`printf agent2live-codex-probe` / `printf agent2live-claude-probe` and
`sleep 30`; everything else is declined. This is not a production policy.

## Privacy

Reports contain counts, short hashes, booleans, versions, and stable codes.
They never contain prompts, assistant text, commands, credentials, session
transcripts, or absolute workspace paths. Temporary workspaces are deleted.
