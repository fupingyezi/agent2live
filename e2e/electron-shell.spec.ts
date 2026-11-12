import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'

// Both windows are created in the same tick, so Playwright's firstWindow() can return either page.
// Resolve each window by its URL to keep the assertions deterministic.
async function studioPage(app: ElectronApplication) {
  return await expect
    .poll(
      async () => {
        const win = app.windows().find((page) => page.url().includes('/studio/'))
        return win ? 'ready' : 'missing'
      },
      { timeout: 20_000 }
    )
    .toBe('ready')
    .then(() => app.windows().find((page) => page.url().includes('/studio/'))!)
}

async function petPage(app: ElectronApplication) {
  return await expect
    .poll(
      async () => {
        const win = app.windows().find((page) => page.url().includes('/pet/'))
        return win ? 'ready' : 'missing'
      },
      { timeout: 20_000 }
    )
    .toBe('ready')
    .then(() => app.windows().find((page) => page.url().includes('/pet/'))!)
}

test('studio and pet are isolated windows; pet click-through is switchable', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'agent2live-shell-'))
  mkdirSync(dataDir, { recursive: true })
  const app = await electron.launch({
    args: ['apps/desktop/out/main/index.js'],
    env: { ...process.env, AGENT2LIVE_DATA_DIR: dataDir, AGENT2LIVE_SKIP_SIDECAR: '1' }
  })
  try {
    const studio = await studioPage(app)
    await expect(studio.locator('[data-testid="studio-ready"]')).toBeVisible()
    expect(studio.url()).toContain('/studio/')

    const pet = await petPage(app)
    await expect(pet.locator('[data-testid="pet-ready"]')).toBeVisible()
    expect(await pet.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgba(0, 0, 0, 0)')

    const initial = await pet.evaluate(() => window.agent2live.getWindowState())
    expect(initial.transparent).toBe(true)
    expect(initial.alwaysOnTop).toBe(true)
    expect(initial.clickThrough).toBe(false)

    const enabled = await pet.evaluate(() => window.agent2live.setClickThrough(true))
    expect(enabled.clickThrough).toBe(true)
    await expect
      .poll(() => pet.evaluate(() => window.agent2live.getWindowState().then((s) => s.clickThrough)))
      .toBe(true)

    const disabled = await pet.evaluate(() => window.agent2live.setClickThrough(false))
    expect(disabled.clickThrough).toBe(false)

    const shot = await pet.screenshot({ omitBackground: true })
    const { data, info } = await sharp(shot).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    const cornerAlpha = data[info.width * 3 * 0 + 3] // 左上角像素 alpha
    expect(cornerAlpha).toBe(0)

    const studioAttempt = await studio.evaluate(async () => {
      try {
        await window.agent2live.setClickThrough(true)
        return 'allowed'
      } catch (error) {
        return error instanceof Error ? error.message : String(error)
      }
    })
    expect(studioAttempt).toContain('window is not allowed')
  } finally {
    await app.close()
  }
})
