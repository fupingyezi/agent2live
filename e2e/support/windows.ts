import { expect, type ElectronApplication } from '@playwright/test'

// Both windows are created in the same tick, so Playwright's firstWindow() can return either page.
// Resolve each window by its URL to keep the assertions deterministic.
export async function studioPage(app: ElectronApplication) {
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

export async function petPage(app: ElectronApplication) {
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
