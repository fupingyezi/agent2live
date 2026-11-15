import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
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
    await expect(studio.locator('[data-testid="studio-breadcrumb"]')).toContainText('角色')
    const characterNav = studio.getByRole('button', { name: '角色', exact: true })
    await expect(characterNav).toHaveAttribute('aria-current', 'page')

    const providerNav = studio.getByRole('button', { name: '设置', exact: true })
    await providerNav.focus()
    await expect(providerNav).toBeFocused()
    await providerNav.press('Enter')
    await expect(studio.getByRole('heading', { name: '模型连接', level: 1 })).toBeVisible()
    await expect(providerNav).toHaveAttribute('aria-current', 'page')
    await studio.getByRole('button', { name: '角色', exact: true }).click()

    const accent = await studio.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--a2l-color-accent').trim()
    )
    expect(accent).toBe('#1f826f')

    await studio.getByRole('link', { name: '新建角色', exact: true }).click()
    await expect(studio.getByRole('heading', { name: '新建角色', level: 1 })).toBeVisible()
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

test('initializes a character from reference images', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'agent2live-studio-references-'))
  const uploadDir = mkdtempSync(join(tmpdir(), 'agent2live-studio-references-upload-'))
  const first = join(uploadDir, 'identity.png')
  const second = join(uploadDir, 'style.png')
  await sharp({
    create: {
      width: 256,
      height: 384,
      channels: 4,
      background: { r: 196, g: 154, b: 168, alpha: 1 }
    }
  })
    .png()
    .toFile(first)
  await sharp({
    create: {
      width: 256,
      height: 384,
      channels: 4,
      background: { r: 92, g: 144, b: 130, alpha: 1 }
    }
  })
    .png()
    .toFile(second)

  const app = await electron.launch({
    args: ['apps/desktop/out/main/index.js'],
    env: { ...process.env, AGENT2LIVE_DATA_DIR: dataDir, AGENT2LIVE_E2E: '1' }
  })

  try {
    const studio = await studioPage(app)
    await expect(studio.locator('[data-testid="studio-ready"]')).toBeVisible()
    await studio.getByRole('link', { name: '新建角色', exact: true }).click()
    await studio.getByLabel('角色名称').fill('霜')
    await studio.getByLabel('角色简介').fill('银白长发、绿色眼睛，安静但会主动替人遮雨的剑士。')
    await studio.getByLabel('上传参考图').setInputFiles([first, second])

    await expect(studio.locator('[data-testid="character-reference-card"]')).toHaveCount(2)
    await studio.getByRole('button', { name: '创建角色', exact: true }).click()

    await expect(studio.locator('[data-testid="art-workbench"]')).toBeVisible({ timeout: 30_000 })
    await expect(studio.locator('[data-testid="prompt-block-list"]')).toBeVisible({ timeout: 20_000 })
    await expect(studio.locator('[data-testid="material-tray"]')).toContainText('身份参考')
    await expect(studio.locator('[data-testid="material-tray"]')).toContainText('风格参考')
  } finally {
    await app.close()
  }
})
