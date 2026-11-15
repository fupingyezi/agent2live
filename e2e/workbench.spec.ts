import { test, expect, _electron as electron, type Page } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { ApiClient, uniqueKey } from './helpers/api'
import { launchStudio } from './helpers/app'
import { makePng } from './helpers/seed'
import { studioPage } from './support/windows'

function hashSearch(url: string): URLSearchParams {
  const hash = new URL(url).hash
  const queryIndex = hash.indexOf('?')
  return new URLSearchParams(queryIndex >= 0 ? hash.slice(queryIndex + 1) : '')
}

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
    await studio.getByLabel('上传参考图').setInputFiles(imagePath)
    await studio.getByRole('button', { name: '创建并生成' }).click()

    await expect(studio.locator('[data-testid="character-created"]')).toBeVisible({
      timeout: 30_000
    })
    await studio.getByTestId('open-art-workbench').click()
    await expect(studio.locator('[data-testid="art-workbench"]')).toBeVisible({ timeout: 30_000 })
    await expect(studio.locator('[data-testid="workbench"]')).toBeVisible({ timeout: 20_000 })
    await expect(studio.locator('[data-testid="prompt-block-list"]')).toBeVisible({
      timeout: 20_000
    })

    const inputPanel = studio.locator('[data-testid="prompt-input-panel"]')
    await expect(inputPanel).toBeVisible()
    await inputPanel.getByRole('button', { name: '展开', exact: true }).click()
    await inputPanel.getByRole('button', { name: /(提交|更新)素材与要求/ }).click()

    await expect(studio.locator('[data-testid="prompt-block-list"]')).toBeVisible({
      timeout: 20_000
    })
    await expect(studio.locator('[data-testid="no-active-draft"]')).toHaveCount(0)
    await expect(studio.locator('[data-testid="material-tray"]')).toContainText('身份参考')

    await studio.getByRole('button', { name: '+ 添加块', exact: true }).click()
    const block = studio.locator('[data-testid="prompt-block"]').last()
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

    await studio.getByRole('button', { name: '生成', exact: true }).click()
    const generationPanel = studio.locator('[data-testid="generation-panel"]')
    await expect(generationPanel).toBeVisible()
    await expect(generationPanel.getByTestId('generation-controls')).toBeVisible()
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
    await generationStatus
      .getByTestId('candidate-strip')
      .getByRole('button', { name: '设置为立绘', exact: true })
      .click()
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

test('queues a Zhipu vision reverse after creation without applying its result', async () => {
  test.setTimeout(120_000)
  const studio = await launchStudio('agent2live-creation-vision-')

  try {
    const api = new ApiClient(studio.endpoint)
    const provider = await api.json<{ id: string }>('POST', '/api/v1/providers', {
      headers: { 'idempotency-key': uniqueKey('provider-zhipu-vision') },
      body: {
        label: 'Creation Zhipu Vision',
        kind: 'chat',
        adapter: 'mock',
        baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
        model: 'glm-5.3-flash',
        enabled: true,
        capabilities: {
          schemaVersion: 'provider-capabilities/1',
          chat: { maxImages: 6, maxPromptChars: 20_000, supportsVision: true }
        }
      }
    })

    await studio.page.getByRole('link', { name: '新建角色', exact: true }).click()
    await studio.page.getByLabel('角色名称').fill('潮')
    await studio.page.getByLabel('角色简介').fill('在海雾里巡灯的白发少女。')
    await studio.page.getByLabel('上传参考图').setInputFiles({
      name: 'identity.png',
      mimeType: 'image/png',
      buffer: await makePng(240, 320, '#9ec9bb')
    })

    const reverseResponsePromise = studio.page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/prompt-reverse')
    )
    let reverseRequestCount = 0
    studio.page.on('request', (request) => {
      if (request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/prompt-reverse')) {
        reverseRequestCount += 1
      }
    })
    await studio.page.getByRole('button', { name: '创建并生成', exact: true }).click()
    const reverseResponse = await reverseResponsePromise
    expect(reverseResponse.status()).toBe(202)
    const reverseRequest = await reverseResponse.json()
    expect(reverseRequest).toMatchObject({
      baseDraftRevision: expect.any(Number),
      baseDraftRowVersion: expect.any(Number),
      jobId: expect.stringMatching(/^job_/)
    })

    await expect(studio.page.locator('[data-testid="character-created"]')).toBeVisible({
      timeout: 30_000
    })
    expect(reverseRequestCount).toBe(1)
    await studio.page.getByTestId('open-art-workbench').click()
    await expect(studio.page.locator('[data-testid="art-workbench"]')).toBeVisible({
      timeout: 30_000
    })
    const workbenchParams = hashSearch(studio.page.url())
    expect(workbenchParams.get('aiKind')).toBe('reverse')
    expect(workbenchParams.get('aiJob')).toBe(reverseRequest.jobId)
    const aiPanel = studio.page.getByTestId('prompt-ai-panel')
    await expect(aiPanel.getByTestId('ai-job')).toContainText(reverseRequest.jobId)
    await expect(aiPanel.getByTestId('reverse-review')).toBeVisible({ timeout: 30_000 })
    const inputPanel = studio.page.getByTestId('prompt-input-panel')
    await inputPanel.getByRole('button', { name: '展开', exact: true }).click()
    await expect(inputPanel.getByLabel('上传素材图片')).toHaveCount(0)
    await expect(inputPanel).toContainText('参考图通过独立参考图编辑入口维护')
    await studio.page.reload()
    await expect(studio.page.locator('[data-testid="art-workbench"]')).toBeVisible({
      timeout: 20_000
    })
    await expect(studio.page.getByTestId('prompt-ai-panel').getByTestId('ai-job')).toContainText(
      reverseRequest.jobId
    )
    await expect(studio.page.getByTestId('reverse-review')).toBeVisible({ timeout: 30_000 })
    expect(reverseRequestCount).toBe(1)
    const projectId = hashSearch(studio.page.url()).get('project')
    expect(projectId).toMatch(/^artp_/)

    const workspace = await api.json<{
      activeDraft: { state: { blocks: Array<{ source: string }> }; rowVersion: number }
      latestSubmission: { materials: Array<{ assetId: string }> }
    }>('GET', `/api/v1/art-projects/${encodeURIComponent(projectId!)}/prompt`)
    expect(workspace.body.activeDraft.rowVersion).toBe(reverseRequest.baseDraftRowVersion)
    const referenceAssetId = workspace.body.latestSubmission.materials[0]?.assetId
    expect(referenceAssetId).toMatch(/^ast_/)

    const job = await api.waitForJob(reverseRequest.jobId)
    const resultId = (job.result as { reverseResultId?: unknown } | null)?.reverseResultId
    expect(resultId).toMatch(/^prv_/)
    const reverseResult = await api.json<{
      status: string
      state: { materialRefs: Array<{ assetId: string }> }
    }>('GET', `/api/v1/prompt-reverse-results/${encodeURIComponent(String(resultId))}`)
    expect(reverseResult.body.status).toBe('ready')
    expect(reverseResult.body.state.materialRefs.map((material) => material.assetId)).toContain(
      referenceAssetId
    )
    expect(workspace.body.activeDraft.state.blocks.some((block) => block.source === 'vision-model')).toBe(
      false
    )
    expect(provider.status).toBe(201)
  } finally {
    await studio.close()
  }
})

test('keeps creation successful and explains when no vision provider is available', async () => {
  test.setTimeout(120_000)
  const studio = await launchStudio('agent2live-creation-no-vision-')

  try {
    await studio.page.getByRole('link', { name: '新建角色', exact: true }).click()
    await studio.page.getByLabel('角色名称').fill('雾')
    await studio.page.getByLabel('角色简介').fill('值守旧灯塔的沉静记录员。')
    await studio.page.getByRole('button', { name: '创建并生成', exact: true }).click()

    await expect(studio.page.locator('[data-testid="character-created"]')).toBeVisible({
      timeout: 30_000
    })
    expect(hashSearch(studio.page.url()).get('aiWarning')).toBe('no-vision-provider')
    await studio.page.getByTestId('open-art-workbench').click()
    await expect(studio.page.locator('[data-testid="art-workbench"]')).toBeVisible({
      timeout: 30_000
    })
    expect(hashSearch(studio.page.url()).get('aiWarning')).toBe('no-vision-provider')
    await expect(studio.page.getByTestId('ai-warning')).toContainText('参考图反推未启动')
  } finally {
    await studio.close()
  }
})
