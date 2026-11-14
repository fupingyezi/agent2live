import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { studioPage } from './support/windows'

test('creates a character and art project, streams events, and survives reload', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'agent2live-studio-shell-'))
  const app = await electron.launch({
    args: ['apps/desktop/out/main/index.js'],
    env: { ...process.env, AGENT2LIVE_DATA_DIR: dataDir, AGENT2LIVE_E2E: '1' }
  })

  try {
    const studio = await studioPage(app)
    await expect(studio.locator('[data-testid="studio-ready"]')).toBeVisible()
    await expect(studio.locator('[data-testid="sse-status"]')).toContainText('实时已连接', {
      timeout: 20_000
    })
    await expect(studio.locator('[data-testid="sse-status"]').locator('[data-state="success"]')).toBeVisible()

    const accent = await studio.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--a2l-color-accent').trim()
    )
    expect(accent).toBe('#3fb0a0')

    await studio.getByRole('link', { name: '新建角色', exact: true }).click()
    await expect(studio.getByRole('heading', { name: '建立一个角色母体', level: 1 })).toBeVisible()
    await studio.getByLabel('角色名称').fill('凛')
    await studio.getByLabel('角色简介').fill('黑发、冷静、带一点疏离感的年轻剑士。')
    await studio.getByRole('button', { name: '创建角色' }).click()

    await expect(studio.getByRole('heading', { name: '凛', level: 1 })).toBeVisible()
    await expect(studio.locator('[data-testid="lineage-empty"]')).toBeVisible()

    await studio.getByLabel('项目名称').fill('默认造型')
    await studio.getByLabel('描述').fill('用于首版立绘与 Live2D 绑定。')
    await studio.getByRole('button', { name: '创建项目' }).click()

    await expect(studio.locator('[data-testid="art-workbench"]')).toBeVisible()
    await expect(studio.getByRole('heading', { name: '默认造型', level: 1 })).toBeVisible()
    await expect.poll(() => studio.url()).toContain('project=artp_')
    const projectUrl = studio.url()

    await studio.reload()
    await expect(studio.locator('[data-testid="studio-ready"]')).toBeVisible()
    await expect(studio.locator('[data-testid="sse-status"]')).toContainText('实时已连接', {
      timeout: 20_000
    })
    await expect(studio.locator('[data-testid="art-workbench"]')).toBeVisible()
    expect(studio.url()).toBe(projectUrl)

    await studio.getByRole('link', { name: /返回角色驾驶舱/ }).click()
    const projectCard = studio.locator('[data-testid="project-card"]').filter({ hasText: '默认造型' })
    await expect(projectCard.locator('[data-testid="art-progress"]')).toHaveAttribute('data-percent', '0')
    await expect(projectCard.getByRole('link', { name: '打开工作台', exact: true })).toBeVisible()
    await expect(projectCard.getByRole('link', { name: 'Live2D', exact: true })).toBeVisible()
    await expect(studio.locator('[data-testid="backup-panel"]')).toBeVisible()
    await expect(studio.locator('[data-testid="backup-empty"]')).toBeVisible()
    await expect(studio.locator('[data-testid="open-live2d"]')).toBeVisible()
  } finally {
    await app.close()
  }
})
