# ADR 0004: Phase 0 platform scope

Status: accepted

## Decision

- Phase 0 proves the desktop product on macOS arm64 only.
- Windows x64 is deferred to the Phase 2 nightly build. Until that evidence
  exists, no Windows support claim is allowed.
- Phase 0 still needs all seven gates to be `pass`; the macOS scope does not
  turn a blocked external dependency into a pass.
- Phase 1 may start only for render/data/contracts/mock-provider work explicitly
  listed by the Phase 0 handoff. Blocked PSD2Live, See-through, Agent, or real
  Provider capabilities must be removed from the Phase 1 scope.

## Rationale

The current deliverable has no Windows build runner and no verified Windows
PSD2Live environment. Recording that constraint as an ADR keeps Phase 0 honest
without blocking the accepted macOS spike.
