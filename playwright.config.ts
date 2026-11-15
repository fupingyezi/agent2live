import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  testMatch:
    /(?:^|[\\/])(?:electron-shell|live2d-render|packaged-data|studio-shell|workbench|providers|live2d-placeholder|ui-evidence|golden-chain|sse-replay)\.spec\.ts$/,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  outputDir: 'test-results',
  snapshotPathTemplate: 'e2e/visual-baselines/phase1/{arg}{ext}',
  use: { trace: 'retain-on-failure' }
})
