import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { studioPage } from '../support/windows'

export interface EndpointInfo {
  schemaVersion: 'endpoint/1'
  baseUrl: string
  token: string
  pid: number
  startedAt: string
}

export interface StudioHandle {
  app: ElectronApplication
  page: Page
  dataDir: string
  endpoint: EndpointInfo
  close(): Promise<void>
}

function readEndpoint(dataDir: string): EndpointInfo | null {
  const path = join(dataDir, 'runtime', 'endpoint.json')
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as Partial<EndpointInfo>
    if (
      value.schemaVersion !== 'endpoint/1' ||
      typeof value.baseUrl !== 'string' ||
      typeof value.token !== 'string' ||
      typeof value.pid !== 'number' ||
      typeof value.startedAt !== 'string'
    )
      return null
    return value as EndpointInfo
  } catch {
    return null
  }
}

export async function waitForEndpoint(dataDir: string, timeoutMs = 20_000): Promise<EndpointInfo> {
  const deadline = Date.now() + timeoutMs
  let lastError = 'endpoint.json was not published'
  while (Date.now() < deadline) {
    const endpoint = readEndpoint(dataDir)
    if (endpoint) {
      try {
        const response = await fetch(new URL('/health', endpoint.baseUrl), {
          headers: { authorization: `Bearer ${endpoint.token}` },
          signal: AbortSignal.timeout(2_000)
        })
        if (response.ok) return endpoint
        lastError = `/health returned ${response.status}`
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error)
      }
    }
    await delay(100)
  }
  throw new Error(`sidecar endpoint was not ready within ${timeoutMs}ms: ${lastError}`)
}

export async function launchStudio(prefix = 'agent2live-e2e-'): Promise<StudioHandle> {
  const dataDir = mkdtempSync(join(tmpdir(), prefix))
  let app: ElectronApplication | null = null
  try {
    app = await electron.launch({
      args: ['apps/desktop/out/main/index.js'],
      env: {
        ...process.env,
        AGENT2LIVE_DATA_DIR: dataDir,
        AGENT2LIVE_E2E: '1'
      }
    })
    const page = await studioPage(app)
    await page.waitForLoadState('domcontentloaded')
    await page.locator('[data-testid="studio-ready"]').waitFor({ state: 'visible', timeout: 30_000 })
    const endpoint = await waitForEndpoint(dataDir)
    let closed = false
    return {
      app,
      page,
      dataDir,
      endpoint,
      close: async () => {
        if (closed) return
        closed = true
        await app!.close()
        if (process.env.AGENT2LIVE_E2E_KEEP_DATA !== '1') {
          rmSync(dataDir, { recursive: true, force: true })
        }
      }
    }
  } catch (error) {
    if (app) await app.close().catch(() => undefined)
    if (process.env.AGENT2LIVE_E2E_KEEP_DATA !== '1') {
      rmSync(dataDir, { recursive: true, force: true })
    }
    throw error
  }
}
