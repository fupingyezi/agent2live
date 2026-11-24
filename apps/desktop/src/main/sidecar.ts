import { app, utilityProcess, type UtilityProcess } from 'electron'
import { existsSync, readFileSync, rmSync, watch, type FSWatcher } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { parseLocalServiceEndpoint, type LocalServiceInfo } from '@agent2live/contracts'
import { resolveEnvValue } from './env-file'
import { getSecretVault } from './secrets'

const ENTRY_WATCH_DEBOUNCE_MS = 200
const SIDECAR_EXIT_TIMEOUT_MS = 2_000

let child: UtilityProcess | null = null
let info: LocalServiceInfo | null = null
let lastError: Error | null = null
let entryWatcher: FSWatcher | null = null
let restartTimer: NodeJS.Timeout | null = null
let restartInFlight = false
let restartQueued = false

function serverEntryCandidates(): string[] {
  if (process.env.AGENT2LIVE_SERVER_ENTRY) return [process.env.AGENT2LIVE_SERVER_ENTRY]
  if (app.isPackaged) return [join(process.resourcesPath, 'server', 'index.cjs')]
  // unpackaged: `out/main/index.js` -> apps/desktop (via app path) or out/main (via __dirname)
  return [
    join(app.getAppPath(), '..', 'server', 'dist', 'index.cjs'),
    join(app.getAppPath(), '..', '..', '..', 'server', 'dist', 'index.cjs'),
    join(__dirname, '..', '..', '..', 'server', 'dist', 'index.cjs')
  ]
}

function serverEntry(): string {
  const candidates = serverEntryCandidates()
  const found = candidates.find((candidate) => existsSync(candidate))
  return found ?? candidates[0]!
}

function dataDir(): string {
  return process.env.AGENT2LIVE_DATA_DIR ?? app.getPath('userData')
}

function repoEnvCandidates(): string[] {
  // Dev only: the repo root .env. app path is apps/desktop (or the repo root itself).
  return [join(app.getAppPath(), '..', '.env'), join(app.getAppPath(), '..', '..', '.env')]
}

function respondToSecretRequest(proc: UtilityProcess, message: unknown): void {
  const request = message as { type?: string; id?: string; secretRef?: string }
  if (request.type !== 'secret.request' || !request.id || !request.secretRef) return
  let value: string | null = null
  try {
    value = getSecretVault().resolve(request.secretRef)
  } catch {
    value = null
  }
  try {
    proc.postMessage({ type: 'secret.response', id: request.id, value })
  } catch {
    // The sidecar exited with the request in flight; its pending resolve already fails closed.
  }
}

export async function startSidecar(): Promise<LocalServiceInfo> {
  if (info) return info
  const entry = serverEntry()
  if (!existsSync(entry)) throw new Error(`server bundle not found: ${entry}`)
  const dir = dataDir()
  const endpointFile = join(dir, 'runtime', 'endpoint.json')
  rmSync(endpointFile, { force: true })

  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value
  }
  env.AGENT2LIVE_DATA_DIR = dir
  // Dev convenience: fill selected vars from the repo .env unless the shell already set them.
  if (!app.isPackaged) {
    for (const key of ['AGENT2LIVE_PORT', 'AGENT2LIVE_TOKEN']) {
      if (process.env[key] !== undefined) continue
      const value = resolveEnvValue(repoEnvCandidates(), key)
      if (value) env[key] = value
    }
  }
  if (app.isPackaged) {
    env.AGENT2LIVE_MIGRATIONS_DIR = join(process.resourcesPath, 'server', 'migrations')
  }

  const proc = utilityProcess.fork(entry, [], { env, stdio: 'pipe' })
  child = proc
  proc.stdout?.on('data', (chunk: Buffer) => console.log(`[sidecar] ${chunk.toString().trimEnd()}`))
  proc.stderr?.on('data', (chunk: Buffer) => console.error(`[sidecar] ${chunk.toString().trimEnd()}`))
  proc.on('message', (message: unknown) => respondToSecretRequest(proc, message))
  proc.on('exit', (code) => {
    // stopSidecar clears the reference before killing, so this exit is intentional.
    if (child !== proc) return
    lastError = new Error(`sidecar exited with code ${code}`)
    info = null
    child = null
  })

  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    if (existsSync(endpointFile)) {
      const raw = readFileSync(endpointFile, 'utf8')
      try {
        info = parseLocalServiceEndpoint(JSON.parse(raw))
        return info
      } catch (error) {
        // JSON.parse may run before the atomic rename completes; only fail fast on
        // well-formed JSON that still does not describe this app's endpoint.
        if (!(error instanceof SyntaxError)) throw error
      }
    }
    if (lastError) throw lastError
    await delay(100)
  }
  throw new Error('sidecar did not publish endpoint.json within 20s')
}

export function getSidecarInfo(): LocalServiceInfo | null {
  return info
}

export function stopSidecar(): void {
  if (!child) return
  try {
    child.kill()
  } finally {
    child = null
    info = null
  }
}

export function watchSidecarForDev(): void {
  if (app.isPackaged || process.env.AGENT2LIVE_DEV_SIDECAR_WATCH !== '1' || entryWatcher) return
  const entry = serverEntry()
  const directory = dirname(entry)
  const filename = basename(entry)
  try {
    entryWatcher = watch(directory, (_event, changed) => {
      // Platforms may report a null filename; treat that as a change to the entry.
      if (changed !== null && changed !== filename) return
      scheduleSidecarRestart()
    })
  } catch (error) {
    console.error('[sidecar] failed to watch server bundle', error)
    return
  }
  entryWatcher.on('error', (error) => {
    console.error('[sidecar] server bundle watcher failed', error)
  })
  console.log(`[sidecar] watching ${entry} for changes`)
}

function scheduleSidecarRestart(): void {
  if (restartTimer) clearTimeout(restartTimer)
  restartTimer = setTimeout(() => {
    restartTimer = null
    void restartSidecar()
  }, ENTRY_WATCH_DEBOUNCE_MS)
  restartTimer.unref()
}

async function restartSidecar(): Promise<void> {
  if (restartInFlight) {
    restartQueued = true
    return
  }
  restartInFlight = true
  try {
    do {
      restartQueued = false
      await restartSidecarOnce()
    } while (restartQueued)
  } finally {
    restartInFlight = false
  }
}

async function restartSidecarOnce(): Promise<void> {
  // Watch events also fire while tsup cleans dist; wait for the rebuilt bundle.
  if (!existsSync(serverEntry())) return
  console.log('[sidecar] server bundle changed, restarting')
  await stopSidecarAndWait()
  lastError = null
  try {
    await startSidecar()
    console.log('[sidecar] restarted')
  } catch (error) {
    console.error('[sidecar] restart failed', error)
  }
}

function stopSidecarAndWait(): Promise<void> {
  const proc = child
  if (!proc) return Promise.resolve()
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, SIDECAR_EXIT_TIMEOUT_MS)
    timer.unref()
    proc.once('exit', () => {
      clearTimeout(timer)
      resolve()
    })
    stopSidecar()
  })
}
