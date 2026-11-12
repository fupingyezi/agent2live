import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { rebuild } from '@electron/rebuild'

const mode = process.argv[2]
const buildPath = resolve('apps/server')
if (mode === 'electron') {
  await rebuild({
    buildPath,
    electronVersion: '44.7.2',
    arch: process.arch,
    onlyModules: ['better-sqlite3'],
    force: true
  })
  console.log('rebuilt better-sqlite3 for Electron 44.7.2')
} else if (mode === 'node') {
  execFileSync('pnpm', ['rebuild', 'better-sqlite3'], { cwd: buildPath, stdio: 'inherit' })
  console.log(`rebuilt better-sqlite3 for Node ${process.versions.node}`)
} else {
  console.error('usage: node scripts/rebuild-native.mjs node|electron')
  process.exit(1)
}
