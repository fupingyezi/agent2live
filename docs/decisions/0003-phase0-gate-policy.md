# ADR 0003: Phase 0 gate policy

Status: accepted

## Rules

1. The seven gates are `G0-RENDER`, `G0-DATA`, `G0-PROVIDER`, `G0-AGENT`,
   `G0-PSD2LIVE`, `G0-SEETHROUGH`, `G0-DOCS`.
2. Overall Phase 0 is `pass` only when every gate is `pass`. Missing evidence is
   `blocked`, never `pass`. Any `fail` outranks `blocked`.
   A `pass` also requires a clean source commit and valid `evidence/1` envelopes
   whose artifact hashes match.
3. Mock evidence proves contracts, not product capability. A stub See-through
   result cannot satisfy `G0-SEETHROUGH`.
4. `G0-PROVIDER` requires the offline contract suite. Real smoke is opt-in; when
   it is disabled, the gate may pass but the report must set
   `checks.realVerified=false`. An enabled smoke that fails fails the gate.
5. `G0-SEETHROUGH` requires a real worker's structural pass, the required-role
   and composite-quality checks **and**
   `psd2liveAcceptance === "pass"` backed by `qc.json`,
   `psd2live-acceptance.json`, and Studio/Pet renderer results that both load,
   animate, expose Idle and contain the required parameters. Structural-only,
   Studio-only, or a hand-edited summary is not enough.
6. `G0-DOCS` fails if plans are tracked, prohibited assets are tracked, the
   license is not GPL-3.0, official/upstream sources were not fetched and hashed,
   or required version/method/license records are missing.
7. No `phase0-gate` tag on `fail` or `blocked`. Local tags are not pushed by
   this plan.
8. Phase 1 may start only on the render/data/contracts/mock-provider subset in
   ADR 0004 while later gates are re-scoped; it cannot consume unproven external
   capabilities.

## Rationale

The project's promises are gated on evidence, not optimism. A blocked gate
removes a capability from the MVP; it does not get relabeled as pass.
