import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs'],
  outDir: 'dist',
  outExtension: () => ({ js: '.cjs' }),
  platform: 'node',
  target: 'node22',
  sourcemap: true,
  clean: true,
  external: ['better-sqlite3', 'sqlite-vec'],
  noExternal: ['@agent2live/contracts', '@agent2live/logging']
})
