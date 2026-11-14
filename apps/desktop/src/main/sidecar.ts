import { app, utilityProcess, type UtilityProcess } from 'electron'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { parseSidecarEndpoint, type SidecarInfo } from '@agent2live/contracts'
import { getSecretVault } from './secrets'

let child: UtilityProcess | null = null
let info: SidecarInfo | null = null
let lastError: Error | null = null

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

export async function startSidecar(): Promise<SidecarInfo> {
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
  if (app.isPackaged) {
    env.AGENT2LIVE_MIGRATIONS_DIR = join(process.resourcesPath, 'server', 'migrations')
  }

  const proc = utilityProcess.fork(entry, [], { env, stdio: 'pipe' })
  child = proc
  proc.stdout?.on('data', (chunk: Buffer) => console.log(`[sidecar] ${chunk.toString().trimEnd()}`))
  proc.stderr?.on('data', (chunk: Buffer) => console.error(`[sidecar] ${chunk.toString().trimEnd()}`))
  proc.on('message', (message: unknown) => respondToSecretRequest(proc, message))
  proc.on('exit', (code) => {
    lastError = new Error(`sidecar exited with code ${code}`)
    info = null
    child = null
  })

  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    if (existsSync(endpointFile)) {
      const raw = readFileSync(endpointFile, 'utf8')
      try {
        info = parseSidecarEndpoint(JSON.parse(raw))
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

export function getSidecarInfo(): SidecarInfo | null {
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
