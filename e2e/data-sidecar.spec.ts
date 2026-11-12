import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { studioPage } from './support/windows'

test('sidecar opens SQLite inside Electron and reports db/events ready', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'agent2live-db-sidecar-'))
  const app = await electron.launch({
    args: ['apps/desktop/out/main/index.js'],
    env: { ...process.env, AGENT2LIVE_DATA_DIR: dataDir, AGENT2LIVE_E2E: '1' }
  })
  try {
    const studio = await studioPage(app)
    await expect(studio.locator('[data-testid="studio-ready"]')).toBeVisible()
    const endpointFile = join(dataDir, 'runtime', 'endpoint.json')
    await expect
      .poll(
        () => {
          try {
            return JSON.parse(readFileSync(endpointFile, 'utf8')).baseUrl as string
          } catch {
            return null
          }
        },
        { timeout: 20_000 }
      )
      .not.toBeNull()
    const endpoint = JSON.parse(readFileSync(endpointFile, 'utf8')) as {
      baseUrl: string
      token: string
    }
    const res = await fetch(`${endpoint.baseUrl}/health`, {
      headers: { authorization: `Bearer ${endpoint.token}` }
    })
    const body = await res.json()
    const electronAbi = await app.evaluate(() => process.versions.modules)
    expect(res.status).toBe(200)
    expect(body.data.db).toBe(true)
    expect(body.data.events).toBe(true)
    expect(body.db.wal).toBe(true)
    expect(body.db.vectorDim).toBe(768)
    expect(body.db.migration).toBe('0001_init')
    expect(body.runtime.modules).toBe(electronAbi)
    const evidence = {
      electronAbi,
      sidecarAbi: body.runtime.modules,
      node: body.runtime.node,
      electron: body.runtime.electron
    }
    expect(evidence.electronAbi).toBe(evidence.sidecarAbi)
    console.log('ABI_EVIDENCE', JSON.stringify(evidence))
  } finally {
    await app.close()
  }
})
