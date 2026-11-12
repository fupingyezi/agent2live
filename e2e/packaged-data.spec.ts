import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { studioPage } from './support/windows'

const executablePath = process.env.AGENT2LIVE_PACKAGED_APP
test.skip(!executablePath, 'packaged app not configured')

test('packaged app starts sidecar, migrations, sqlite-vec, FTS5 and SSE route', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'agent2live-packaged-'))
  const app = await electron.launch({
    executablePath,
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
        { timeout: 30_000 }
      )
      .not.toBeNull()
    const endpoint = JSON.parse(readFileSync(endpointFile, 'utf8')) as {
      baseUrl: string
      token: string
    }
    const headers = { authorization: `Bearer ${endpoint.token}` }
    const health = await (await fetch(`${endpoint.baseUrl}/health`, { headers })).json()
    expect(health.data).toEqual({ db: true, events: true })
    expect(health.db.vectorDim).toBe(768)
    expect(health.db.migration).toBe('0001_init')

    const sse = await fetch(`${endpoint.baseUrl}/api/v1/events?after=0`, { headers })
    expect(sse.status).toBe(200)
    expect(sse.headers.get('content-type')).toContain('text/event-stream')
    await sse.body?.cancel()
  } finally {
    await app.close()
  }
})
