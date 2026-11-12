# PSD2Live Phase 0 spike

This directory is a time-boxed spike, not product code.

## Time box

2 working days from first edit. Stop and record evidence when exceeded.

## Setup

1. Install PSD2Live from source outside this repo (v3.4.0 or the version you record).
2. Generate fixtures: `pnpm exec tsx spikes/psd2live/make-fixture.ts --out spikes/psd2live/work/fixture.psd`
3. Run CLI probe: `PSD2LIVE_DIR=... pnpm exec tsx spikes/psd2live/cli-probe.ts`
4. Enable MCP in PSD2Live Settings, then run `PSD2LIVE_MCP_TOKEN=... pnpm exec tsx spikes/psd2live/probe.ts`

Never commit tokens, PSDs, moc3 files, evidence, or the PSD2Live checkout.

## Pass / fail / blocked

- pass: Cubism 4.2 export passes `qcModelDirectory` and the Electron harness loads it.
- fail: a tool exists but the pipeline or QC fails; record the raw response.
- blocked: install, MCP, token, or macOS runtime is unavailable; do not claim auto-bind.
