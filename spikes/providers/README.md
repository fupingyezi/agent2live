# Provider smoke

Contract tests are offline and live in `packages/providers/tests`.

Real smoke is opt-in and costs money:

```bash
PROVIDER_SMOKE_REAL=1 \
OPENAI_BASE_URL=... OPENAI_API_KEY=... OPENAI_MODEL=... \
SEEDREAM_API_KEY=... SEEDREAM_MODEL=... \
pnpm exec tsx spikes/providers/real-smoke.ts
```

Never commit keys, generated images, or evidence. Missing env is reported as `blocked`,
not as a pass.
