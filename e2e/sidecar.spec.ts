import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('sidecar is loopback-only, token-protected, and 0600', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'agent2live-sidecar-'))
  const app = await electron.launch({
    args: ['apps/desktop/out/main/index.js'],
    env: { ...process.env, AGENT2LIVE_DATA_DIR: dataDir, AGENT2LIVE_E2E: '1' }
  })
  try {
    const studio = await app.firstWindow()
    await expect(studio.locator('[data-testid="studio-ready"]')).toBeVisible()
    const endpointFile = join(dataDir, 'runtime', 'endpoint.json')
    await expect
      .poll(
        () => {
          try {
            statSync(endpointFile)
            return true
          } catch {
            return false
          }
        },
        { timeout: 20_000 }
      )
      .toBe(true)

    expect(statSync(endpointFile).mode & 0o777).toBe(0o600)
    const endpoint = JSON.parse(readFileSync(endpointFile, 'utf8')) as {
      baseUrl: string
      token: string
    }
    expect(endpoint.baseUrl.startsWith('http://127.0.0.1:')).toBe(true)
    expect(endpoint.baseUrl).not.toContain('0.0.0.0')

    const unauthorized = await fetch(`${endpoint.baseUrl}/health`)
    expect(unauthorized.status).toBe(401)
    const authorized = await fetch(`${endpoint.baseUrl}/health`, {
      headers: { authorization: `Bearer ${endpoint.token}` }
    })
    expect(authorized.status).toBe(200)
    expect((await authorized.json()).data.db).toBe(false)
  } finally {
    await app.close()
  }
})
