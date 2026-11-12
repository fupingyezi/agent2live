import { cpSync, existsSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

function walk(dir, predicate, found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const file = join(dir, entry.name)
    if (entry.isDirectory()) walk(file, predicate, found)
    else if (predicate(file)) found.push(file)
  }
  return found
}

function walkLinks(dir, found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const file = join(dir, entry.name)
    if (entry.isSymbolicLink()) found.push(file)
    else if (entry.isDirectory()) walkLinks(file, found)
  }
  return found
}

run('pnpm', ['--filter', '@agent2live/server', 'build'])
run('pnpm', ['--filter', '@agent2live/desktop', 'build'])

// electron-builder cannot follow pnpm's workspace symlinks into a packaged app.
// Stage a self-contained copy of the server runtime (real dependency files).
const staging = resolve('apps/desktop/.packaged-server')
rmSync(staging, { recursive: true, force: true })
run('pnpm', ['--filter', '@agent2live/server', 'deploy', '--prod', '--legacy', staging])
// pnpm deploy leaves the workspace modules manifest in a production-pruned state;
// refresh it so later pnpm commands do not attempt an interactive reinstall.
run('pnpm', ['install', '--frozen-lockfile'])

const dist = join(staging, 'dist')
for (const entry of readdirSync(dist)) {
  cpSync(join(dist, entry), join(staging, entry), { recursive: true, force: true })
}
rmSync(dist, { recursive: true, force: true })
for (const entry of ['src', 'scripts', 'tsconfig.json', 'tsup.config.ts']) {
  rmSync(join(staging, entry), { recursive: true, force: true })
}
// Legacy deploy leaves a self-alias to the workspace root; it dangles once packaged.
rmSync(join(staging, 'node_modules', '.pnpm', 'node_modules', '@agent2live', 'server'), {
  force: true
})
const brokenLinks = walkLinks(staging).filter((link) => !existsSync(link))
if (brokenLinks.length > 0) {
  throw new Error(`PACKAGED_SERVER_BROKEN_SYMLINK:${brokenLinks.join(',')}`)
}
if (!existsSync(join(staging, 'index.cjs'))) throw new Error('PACKAGED_SERVER_ENTRY_MISSING')
if (!existsSync(join(staging, 'migrations', '0001_init.sql'))) {
  throw new Error('PACKAGED_SERVER_MIGRATIONS_MISSING')
}

run('pnpm', ['--filter', '@agent2live/desktop', 'pack:dir'])

const release = join('apps', 'desktop', 'release')
const archDir = readdirSync(release).find((name) => name.startsWith('mac-'))
if (!archDir) throw new Error('PACKAGED_ARCH_DIR_MISSING')
const contents = join(release, archDir, 'agent2live.app', 'Contents')
const executable = join(contents, 'MacOS', 'agent2live')
if (!existsSync(executable)) throw new Error(`PACKAGED_EXECUTABLE_MISSING:${executable}`)
if (!statSync(executable).isFile()) throw new Error(`PACKAGED_EXECUTABLE_NOT_FILE:${executable}`)

const server = join(contents, 'Resources', 'server')
if (!existsSync(join(server, 'index.cjs'))) throw new Error(`PACKAGED_SERVER_ENTRY_MISSING:${server}`)
if (!existsSync(join(server, 'migrations', '0001_init.sql'))) {
  throw new Error(`PACKAGED_SERVER_MIGRATIONS_MISSING:${server}`)
}
const native = walk(server, (file) => file.endsWith('.node') || file.endsWith('.dylib'))
const hasSqlite =
  native.some((file) => file.endsWith('darwin-arm64.node') || file.includes('better_sqlite3.node')) &&
  native.some((file) => file.endsWith('vec0.dylib'))
if (!hasSqlite) throw new Error(`PACKAGED_SERVER_NATIVE_MISSING:${native.join(',')}`)
console.log(`packaged native modules: ${native.length} file(s)`)
console.log(executable)
