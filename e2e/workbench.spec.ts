import { test, expect, _electron as electron, type Page } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { studioPage } from './support/windows'

async function createMockProvider(page: Page, kind: 'chat' | 'image'): Promise<void> {
  await page.evaluate(
    async ({ providerKind }) => {
      const bridge = window.agent2live
      if (!bridge) throw new Error('preload bridge is unavailable')
      const info = await bridge.getServerInfo()
      const capabilities =
        providerKind === 'chat'
          ? {
              schemaVersion: 'provider-capabilities/1',
              chat: { maxImages: 8, maxPromptChars: 20000, supportsVision: true }
            }
          : {
              schemaVersion: 'provider-capabilities/1',
              image: {
                maxReferenceImages: 4,
                maxPromptChars: 20000,
                supportsNegativePrompt: true,
                supportsWeightSyntax: true,
                supportsSeed: true,
                maxCount: 4,
                sizes: ['512x896', '1024x1792']
              }
            }
      const response = await fetch(`${info.baseUrl}/api/v1/providers`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${info.token}`,
          'content-type': 'application/json',
          'idempotency-key': `workbench-${providerKind}-provider`
        },
        body: JSON.stringify({
          label: providerKind === 'chat' ? 'Workbench Mock Chat' : 'Workbench Mock Image',
          kind: providerKind,
          adapter: 'mock',
          enabled: true,
          capabilities
        })
      })
      if (!response.ok) throw new Error(await response.text())
    },
    { providerKind: kind }
  )
}

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
    await expect(studio.locator('[data-testid="studio-global-status"]')).toContainText('实时已连接', {
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
    await expect(studio.locator('[data-testid="material-tray"]')).toHaveCount(0)
    await inputPanel.getByLabel('上传素材图片').setInputFiles(imagePath)
    await inputPanel.getByRole('button', { name: '提交素材与要求', exact: true }).click()

    await expect(studio.locator('[data-testid="prompt-block-list"]')).toBeVisible({
      timeout: 20_000
    })
    await expect(studio.locator('[data-testid="no-active-draft"]')).toHaveCount(0)
    await expect(studio.locator('[data-testid="material-tray"]')).toContainText('身份参考')

    await studio.getByRole('button', { name: '+ 添加块', exact: true }).click()
    const block = studio.locator('[data-testid="prompt-block"]').first()
    await expect(block).toBeVisible()
    await block.getByLabel('块名称').fill('面部')
    await block.getByLabel('块内容').fill('黑色短发，冷静的灰色眼睛，干净的面部轮廓')

    const toolbar = studio.locator('[data-testid="draft-toolbar"]')
    await expect(toolbar).toContainText('有未保存修改')
    await expect(studio.locator('[data-testid="unsaved-notice"]')).toBeVisible()
    await expect(toolbar.getByRole('button', { name: 'AI 助手', exact: true })).toBeDisabled()
    await toolbar.getByRole('button', { name: '保存草稿', exact: true }).click()
    await expect(toolbar).toContainText('草稿已保存', { timeout: 20_000 })
    await expect(studio.locator('[data-testid="unsaved-notice"]')).toHaveCount(0)
    await expect(toolbar.getByRole('button', { name: 'AI 助手', exact: true })).toBeEnabled()

    await createMockProvider(studio, 'chat')
    await createMockProvider(studio, 'image')
    await studio.reload()
    await expect(studio.locator('[data-testid="workbench"]')).toBeVisible({ timeout: 20_000 })
    await expect(studio.locator('[data-testid="draft-toolbar"]')).toContainText('草稿已保存')

    await studio.locator('[data-testid="draft-toolbar"]').getByRole('button', { name: 'AI 助手' }).click()
    const aiPanel = studio.locator('[data-testid="prompt-ai-panel"]')
    await expect(aiPanel).toBeVisible()
    await aiPanel.getByRole('tab', { name: '改进建议' }).click()
    await expect(aiPanel.getByTestId('ai-request-settings')).toBeHidden()
    await aiPanel.getByText('模型与改进方向', { exact: true }).click()
    await expect(aiPanel.getByTestId('ai-request-settings')).toBeVisible()
    await aiPanel.getByRole('button', { name: '生成建议', exact: true }).click()
    await expect(aiPanel.getByTestId('ai-job')).toBeVisible()
    await expect(aiPanel.getByTestId('suggestion-diff')).toBeVisible({ timeout: 30_000 })
    await aiPanel.getByRole('button', { name: '接受建议', exact: true }).click()
    await expect(studio.locator('[data-testid="draft-toolbar"]')).toContainText('草稿已保存', {
      timeout: 20_000
    })

    await toolbar.getByRole('button', { name: '提交版本', exact: true }).click()
    const commitDialog = studio.getByRole('dialog')
    await expect(commitDialog).toBeVisible()
    await commitDialog.getByRole('button', { name: '提交版本', exact: true }).click()

    await expect(studio.locator('[data-testid="no-active-draft"]')).toBeVisible({
      timeout: 20_000
    })
    await expect(studio.getByTestId('version-graph')).toContainText('v1')
    await expect(studio.locator('[data-testid="reference-chain"]')).toContainText('提示词 v1')

    await studio.getByRole('tab', { name: '生成', exact: true }).click()
    const generationPanel = studio.locator('[data-testid="generation-panel"]')
    await expect(generationPanel).toBeVisible()
    await expect(generationPanel.getByTestId('generation-settings')).toBeHidden()
    await generationPanel.getByText('生成设置', { exact: true }).click()
    await expect(generationPanel.getByTestId('generation-settings')).toBeVisible()
    await generationPanel.getByRole('button', { name: '开始生成', exact: true }).click()
    const generationStatus = generationPanel.getByTestId('generation-status')
    await expect(generationStatus).toBeVisible()
    await expect(generationStatus.getByTestId('candidate-compare')).toBeVisible({ timeout: 30_000 })
    await expect(generationStatus.getByTestId('candidate-stage')).toBeVisible()
    await expect(generationStatus.getByTestId('candidate-strip')).toBeVisible()
    await expect(generationStatus.getByTestId('candidate-card')).not.toHaveCount(0)
    const candidate = generationStatus.getByTestId('candidate-card').first()
    await expect(candidate.getByRole('img', { name: '生成候选' })).toBeVisible()
    await candidate.getByRole('button', { name: '接受候选', exact: true }).click()
    const candidateDialog = studio.getByRole('dialog')
    await candidateDialog.getByRole('button', { name: '接受', exact: true }).click()
    await expect(studio.locator('[data-testid="art-version-panel"]')).toContainText('active v1', {
      timeout: 20_000
    })

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
    await expect(artPanel).toContainText('active v2')

    await referenceEditor.getByLabel('添加参考图片').setInputFiles(auxiliaryPath)
    await expect(referenceEditor.getByTestId('reference-row')).toHaveCount(2, {
      timeout: 20_000
    })
    await referenceEditor.getByRole('button', { name: '保存为新版本', exact: true }).click()

    await expect(artPanel).toContainText('active v3', { timeout: 20_000 })
    await expect(referenceEditor.getByTestId('reference-row')).toHaveCount(2)
    await expect(referenceEditor.getByTestId('reference-row').first()).toContainText('主参考')

    await studio.reload()
    await expect(studio.locator('[data-testid="studio-ready"]')).toBeVisible()
    await expect(studio.locator('[data-testid="workbench"]')).toBeVisible({ timeout: 20_000 })
    await expect(studio.getByTestId('version-graph')).toContainText('v1')
    await expect(studio.locator('[data-testid="no-active-draft"]')).toBeVisible()
    await expect(studio.locator('[data-testid="art-version-panel"]')).toContainText('active v3')
    await expect(
      studio.locator('[data-testid="reference-set-editor"]').getByTestId('reference-row')
    ).toHaveCount(2)
  } finally {
    await app.close()
  }
})
