import { readFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const required = [
  'package.json',
  'pnpm-lock.yaml',
  'tsconfig.base.json',
  'vitest.config.ts',
  'playwright.config.ts',
  '.editorconfig',
  '.prettierrc.json',
  '.prettierignore',
  'docs/versions.md',
  'docs/sources/phase0-official-sources.json',
  'LICENSE',
  'apps/desktop/package.json',
  'apps/server/package.json',
  'packages/contracts/package.json',
  'packages/logging/package.json',
  'packages/live2d-runtime/package.json',
  'packages/providers/package.json',
  'scripts/evidence.mjs'
]
const missing = required.filter((file) => !existsSync(file))
if (missing.length) {
  console.error(`missing: ${missing.join(', ')}`)
  process.exit(1)
}
const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
if (pkg.private !== true) throw new Error('root package must stay private')
const license = readFileSync('LICENSE', 'utf8')
if (!license.includes('GNU GENERAL PUBLIC LICENSE') || !license.includes('Version 3')) {
  throw new Error('LICENSE must be GPL-3.0')
}
const pnpm = execFileSync('pnpm', ['--version']).toString().trim()
const node = process.versions.node
console.log(JSON.stringify({ pnpm, node, baseline: { node: '22.23.2', pnpm: '11.25.0' } }, null, 2))
