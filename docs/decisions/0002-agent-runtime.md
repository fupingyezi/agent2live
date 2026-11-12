# ADR 0002: Phase 0 Agent Control Planes

Status: proposed

## Decision

Phase 0 uses only official control planes:

- Codex: `codex app-server --stdio`, JSONL messages without a `jsonrpc` field.
  The probe uses `initialize`, `initialized`, `thread/start`, `thread/resume`,
  `turn/start`, and `turn/interrupt`, and responds to
  `item/commandExecution/requestApproval` / `item/fileChange/requestApproval`.
- Claude: `@anthropic-ai/claude-agent-sdk` `query()` in streaming and text modes,
  `Query.interrupt()`, `canUseTool`, and `resume`.

No TUI scraping, transcript parsing, GUI automation, or inferred fields.

## Approval rules

The probes are not production permission policy. They allow only the literal
probe commands (`printf agent2live-*-probe`, `sleep 30`) and decline everything
else. Production defaults remain workspace-write, network off, on-request
approval; timeouts are never implicit approval.

## Evidence

- Codex protocol Schema is generated locally with
  `codex app-server generate-json-schema --out <tmp>` and must match the locked
  CLI version.
- Claude SDK peer versions: SDK `0.3.319`, `zod` v4 at the probe root, MCP SDK
  `1.32.2`.
- Probe reports live under ignored `docs/plans/evidence/phase0/G0-AGENT/`.
- A missing login or API key is `blocked`, not fail and never pass.

## Consequences

`G0-AGENT` cannot pass on a machine with only one working provider. Phase 4
fallback work is independent, but Phase 0 overall still requires both probes.
