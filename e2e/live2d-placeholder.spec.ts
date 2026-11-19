import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { studioPage } from './support/windows'

test('offers a Phase 2 Live2D placeholder from character and project entry points', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'agent2live-live2d-placeholder-'))
  const app = await electron.launch({
    args: ['apps/desktop/out/main/index.js'],
    env: { ...process.env, AGENT2LIVE_DATA_DIR: dataDir, AGENT2LIVE_E2E: '1' }
  })

  try {
    const studio = await studioPage(app)
    await expect(studio.locator('[data-testid="studio-ready"]')).toBeVisible()

    await studio.getByRole('link', { name: '新建角色', exact: true }).click()
    await studio.getByLabel('角色名称').fill('凛')
    await studio.getByRole('button', { name: '创建并生成', exact: true }).click()
    await expect(studio.locator('[data-testid="character-created"]')).toBeVisible({
      timeout: 30_000
    })
    await studio.getByTestId('open-art-workbench').click()
    await expect(studio.locator('[data-testid="art-workbench"]')).toBeVisible({ timeout: 30_000 })

    const characterId = decodeURIComponent(new URL(studio.url()).hash.split('/')[2] ?? '')
    await studio.evaluate((id) => {
      window.location.hash = `#/characters/${encodeURIComponent(id)}`
    }, characterId)
    const projectCard = studio.locator('[data-testid="project-card"]').filter({ hasText: '默认造型' })
    await expect(projectCard).toBeVisible()
    await projectCard.getByRole('link', { name: 'Live2D', exact: true }).click()

    const placeholder = studio.locator('[data-testid="live2d-placeholder"]')
    await expect(placeholder).toBeVisible()
    await expect(studio.getByRole('heading', { name: '凛', level: 1 })).toBeVisible()
    await expect(studio.getByText('美术来源：默认造型')).toBeVisible()
    await expect(studio.locator('[data-testid="live2d-empty"]')).toContainText('Phase 2')

    await studio.getByRole('link', { name: /返回角色驾驶舱/ }).click()
    await studio.evaluate((id) => {
      window.location.hash = `#/characters/${encodeURIComponent(id)}/live2d`
    }, characterId)
    await expect(studio.locator('[data-testid="live2d-placeholder"]')).toHaveAttribute('data-project-id', '')
    await expect(studio.getByText('尚未选择美术项目；可以先在驾驶舱里打开一个项目。')).toBeVisible()
  } finally {
    await app.close()
  }
})
