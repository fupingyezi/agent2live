import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: [
      '{apps,packages}/**/*.test.ts',
      '{apps,packages}/**/__tests__/**/*.test.ts',
      'spikes/**/*.test.ts',
      'scripts/**/*.test.ts'
    ],
    environment: 'node',
    testTimeout: 20_000,
    hookTimeout: 20_000,
    restoreMocks: true
  }
})
