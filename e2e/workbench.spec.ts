import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { studioPage } from './support/windows'

test('submits materials, saves a draft, commits a prompt version, and survives reload', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'agent2live-workbench-'))
  const uploadDir = mkdtempSync(join(tmpdir(), 'agent2live-workbench-upload-'))
  const imagePath = join(uploadDir, 'identity.png')
  const auxiliaryPath = join(uploadDir, 'auxiliary.png')
  await sharp({
    create: {
      width: 256,
      height: 256,
      channels: 4,
      background: { r: 182, g: 83, b: 60, alpha: 1 }
    }
  })
    .png()
    .toFile(imagePath)
  await sharp({
    create: {
      width: 256,
      height: 256,
      channels: 4,
      background: { r: 63, g: 176, b: 160, alpha: 1 }
    }
  })
    .png()
    .toFile(auxiliaryPath)

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

    await studio.getByRole('link', { name: '新建角色', exact: true }).click()
    await studio.getByLabel('角色名称').fill('凛')
    await studio.getByLabel('角色简介').fill('黑发、冷静、带一点疏离感的年轻剑士。')
    await studio.getByRole('button', { name: '创建角色' }).click()

    await expect(studio.getByRole('heading', { name: '凛', level: 1 })).toBeVisible()
    await studio.getByLabel('项目名称').fill('默认造型')
    await studio.getByLabel('描述').fill('用于首版立绘与 Live2D 绑定。')
    await studio.getByRole('button', { name: '创建项目' }).click()

    await expect(studio.locator('[data-testid="art-workbench"]')).toBeVisible()
    await expect(studio.locator('[data-testid="workbench"]')).toBeVisible({ timeout: 20_000 })
    await expect(studio.locator('[data-testid="no-active-draft"]')).toBeVisible()

    const inputPanel = studio.locator('[data-testid="prompt-input-panel"]')
    await expect(inputPanel).toBeVisible()
    await inputPanel.getByLabel('上传素材图片').setInputFiles(imagePath)
    await inputPanel.getByRole('button', { name: '提交素材与要求', exact: true }).click()

    await expect(studio.locator('[data-testid="prompt-block-list"]')).toBeVisible({
      timeout: 20_000
    })
    await expect(studio.locator('[data-testid="material-tray"]')).toContainText('身份参考')

    await studio.getByRole('button', { name: '+ 添加块', exact: true }).click()
    const block = studio.locator('[data-testid="prompt-block"]').first()
    await expect(block).toBeVisible()
    await block.getByLabel('块名称').fill('面部')
    await block.getByLabel('块内容').fill('黑色短发，冷静的灰色眼睛，干净的面部轮廓')

    const toolbar = studio.locator('[data-testid="draft-toolbar"]')
    await expect(toolbar).toContainText('有未保存修改')
    await toolbar.getByRole('button', { name: '保存草稿', exact: true }).click()
    await expect(toolbar).toContainText('草稿已保存', { timeout: 20_000 })

    await toolbar.getByRole('button', { name: '提交版本', exact: true }).click()
    const commitDialog = studio.getByRole('dialog')
    await expect(commitDialog).toBeVisible()
    await commitDialog.getByRole('button', { name: '提交版本', exact: true }).click()

    await expect(studio.locator('[data-testid="no-active-draft"]')).toBeVisible({
      timeout: 20_000
    })
    await expect(studio.getByTestId('version-graph')).toContainText('v1')
    await expect(studio.locator('[data-testid="reference-chain"]')).toContainText('提示词 v1')

    const artPanel = studio.locator('[data-testid="art-version-panel"]')
    await expect(artPanel).toBeVisible()
    await artPanel.getByLabel('选择手工美术图片').setInputFiles(imagePath)
    await artPanel.getByRole('button', { name: '创建手工美术版本', exact: true }).click()
    const manualDialog = studio.getByRole('dialog')
    await expect(manualDialog).toBeVisible()
    await manualDialog.getByRole('button', { name: '创建', exact: true }).click()

    const referenceEditor = artPanel.locator('[data-testid="reference-set-editor"]')
    await expect(referenceEditor).toBeVisible({ timeout: 20_000 })
    await expect(referenceEditor.getByTestId('reference-row')).toHaveCount(1)
    await expect(artPanel).toContainText('active v1')

    await referenceEditor.getByLabel('添加参考图片').setInputFiles(auxiliaryPath)
    await expect(referenceEditor.getByTestId('reference-row')).toHaveCount(2, {
      timeout: 20_000
    })
    await referenceEditor.getByRole('button', { name: '保存为新版本', exact: true }).click()

    await expect(artPanel).toContainText('active v2', { timeout: 20_000 })
    await expect(referenceEditor.getByTestId('reference-row')).toHaveCount(2)
    await expect(referenceEditor.getByTestId('reference-row').first()).toContainText('主参考')

    await studio.reload()
    await expect(studio.locator('[data-testid="studio-ready"]')).toBeVisible()
    await expect(studio.locator('[data-testid="workbench"]')).toBeVisible({ timeout: 20_000 })
    await expect(studio.getByTestId('version-graph')).toContainText('v1')
    await expect(studio.locator('[data-testid="no-active-draft"]')).toBeVisible()
    await expect(studio.locator('[data-testid="art-version-panel"]')).toContainText('active v2')
    await expect(
      studio.locator('[data-testid="reference-set-editor"]').getByTestId('reference-row')
    ).toHaveCount(2)
  } finally {
    await app.close()
  }
})
