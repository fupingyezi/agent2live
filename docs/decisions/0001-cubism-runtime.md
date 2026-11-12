# 0001: Cubism runtime baseline

- Status: accepted for Phase 0; revisit when a Cubism 5-only feature is required
- Date: 2026-11-12
- Owners: agent2live maintainers

## Decision

Phase 1 uses `pixi-live2d-display-lipsyncpatch@0.5.0-ls-8` with `pixi.js@7.4.3` as the
only Cubism runtime. PSD2Live exports target Cubism **4.2** by default. A Cubism 5.0
export may be recorded as compatibility evidence but is not a supported output until a
separate decision updates this record.

`live2dcubismcore.min.js` is supplied by the user locally and is never committed or
redistributed.

## Evidence

- Render matrix: `docs/plans/evidence/phase0/G0-RENDER/matrix.json` (local, ignored)
- PSD2Live matrix: `docs/plans/evidence/phase0/G0-PSD2LIVE/render/matrix.json` (local, ignored)
- Haru smoke: `docs/plans/evidence/phase0/G0-RENDER/probe.json` (local, ignored)

Observed values from the local G0-RENDER matrix run (`--gate G0-RENDER`, 2026-11-12):

| Model                           | model3 Version                                                                       | MOC3 raw version                       | Core version | Loaded  | Animated |
| ------------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------- | ------------ | ------- | -------- |
| Haru                            | 3                                                                                    | `0x01000000` (16777216; MOC3 major v1) | `5.1.0.0`    | true    | true     |
| PSD2Live 4.2 fixture            | not run — G0-PSD2LIVE blocked (PSD2LIVE_MCP_TOKEN_MISSING; real layered PSD missing) | not run                                | not run      | not run | not run  |
| PSD2Live 5.0 fixture (optional) | not run                                                                              | not run                                | not run      | not run | not run  |

Neither PSD2Live row was rendered. The PSD2Live gate is blocked at decomposition, so
there is no 4.2 or 5.0 export to load. The Task 8 synthetic CLI model is a Cubism 5.0
QC-only fixture; it is not a supported export and is not evidence for either PSD2Live row.

## Consequences

- Phase 2 binder requests 4.2 from PSD2Live; if 4.2 is unavailable, automatic binding
  stops and the Manual-First variant applies.
- Do not introduce a second Live2D wrapper to gain Cubism 5 support in Phase 0/1.
- Any model that only exports at 5.0 is rejected with `CUBISM_VERSION_UNSUPPORTED`
  rather than silently rendered with an untested wrapper.
