import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      '@desktop/shared': resolve(import.meta.dirname, 'apps/desktop/src/shared'),
      '@renderer': resolve(import.meta.dirname, 'apps/desktop/src/renderer'),
      '@studio': resolve(import.meta.dirname, 'apps/desktop/src/renderer/studio')
    }
  },
  test: {
    testTimeout: 20_000,
    hookTimeout: 20_000,
    restoreMocks: true,
    projects: [
      {
        test: {
          name: 'node',
          include: [
            '{apps,packages}/**/*.test.ts',
            '{apps,packages}/**/*.test.tsx',
            '{apps,packages}/**/__tests__/**/*.test.ts',
            'spikes/**/*.test.ts',
            'scripts/**/*.test.ts'
          ],
          exclude: [
            '**/node_modules/**',
            '**/dist/**',
            '**/.packaged-server/**',
            'packages/design-system/**'
          ],
          environment: 'node',
          testTimeout: 20_000,
          hookTimeout: 20_000,
          restoreMocks: true
        }
      },
      './packages/design-system/vitest.config.ts'
    ]
  }
})
