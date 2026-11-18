import { test, expect, type Page } from '@playwright/test'
import { ApiClient, uniqueKey } from './helpers/api'
import { launchStudio } from './helpers/app'
import { goldenPromptState, makePng } from './helpers/seed'

interface ProviderSummary {
  id: string
}

async function createImageProvider(api: ApiClient, maxPromptChars = 20_000): Promise<ProviderSummary> {
  const response = await api.json<ProviderSummary>('POST', '/api/v1/providers', {
    headers: { 'idempotency-key': uniqueKey('provider-image') },
    body: {
      label: 'Mock 生图',
      kind: 'image',
      adapter: 'mock',
      capabilities: {
        schemaVersion: 'provider-capabilities/1',
        image: {
          maxReferenceImages: 4,
          maxPromptChars,
          supportsNegativePrompt: true,
          supportsWeightSyntax: true,
          supportsSeed: true,
          maxCount: 4,
          sizes: ['512x896', '1024x1792']
        }
      }
    }
  })
  return response.body
}

async function createChatProvider(api: ApiClient): Promise<ProviderSummary> {
  const response = await api.json<ProviderSummary>('POST', '/api/v1/providers', {
    headers: { 'idempotency-key': uniqueKey('provider-chat') },
    body: {
      label: 'Mock Chat',
      kind: 'chat',
      adapter: 'mock',
      capabilities: {
        schemaVersion: 'provider-capabilities/1',
        chat: { maxImages: 8, maxPromptChars: 20_000, supportsVision: true }
      }
    }
  })
  return response.body
}

async function seedWorkbench(api: ApiClient) {
  const character = await api.createCharacter('霜', '银白长发 绿色瞳孔')
  const project = await api.createProject(character.id, '默认造型')
  const input = await api.uploadPromptInput(project.id, await makePng(), {
    filename: 'identity.png'
  })
  const state = goldenPromptState(input.submission.materials[0]!.assetId)
  const saved = await api.savePromptDraft(project.id, input.draft.id, state, input.draft.rowVersion)
  const committed = await api.commitPromptDraft(project.id, saved.id, saved.rowVersion)
  return { character, project, version: committed.version }
}

async function seedLongPromptWorkbench(api: ApiClient) {
  const character = await api.createCharacter('霜', '银白长发 绿色瞳孔')
  const project = await api.createProject(character.id, '默认造型')
  const input = await api.uploadPromptInput(project.id, await makePng(), {
    filename: 'identity.png'
  })
  const state = goldenPromptState(input.submission.materials[0]!.assetId)
  const blocks = state.blocks as Array<{ id: string; text: string }>
  const style = blocks.find((block) => block.id === 'style.rendering')
  if (!style) throw new Error('seeded prompt is missing the style block')
  style.text = '非常长的风格描述'.repeat(150)
  const saved = await api.savePromptDraft(project.id, input.draft.id, state, input.draft.rowVersion)
  const committed = await api.commitPromptDraft(project.id, saved.id, saved.rowVersion)
  return { character, project, version: committed.version }
}

async function openWorkbench(page: Page, characterId: string, projectId: string, query = ''): Promise<void> {
  await page.evaluate(
    (hash) => {
      window.location.hash = hash
    },
    `#/characters/${encodeURIComponent(characterId)}/art?project=${encodeURIComponent(projectId)}${query}`
  )
  await expect(page.locator('[data-testid="art-workbench"]')).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('[data-testid="workbench"]')).toBeVisible({ timeout: 20_000 })
}

test('renders the v3 prompt workbench and saves block edits as a new version', async () => {
  const studio = await launchStudio('agent2live-v3-prompt-')
  try {
    const api = new ApiClient(studio.endpoint)
    const seeded = await seedWorkbench(api)
    await openWorkbench(studio.page, seeded.character.id, seeded.project.id)

    await expect(studio.page.locator('[data-testid="wb3-topbar"]')).toContainText('提示词工作台')
    await expect(studio.page.locator('[data-testid="wb3-prompt-editor"]')).toContainText('霜')
    await expect(studio.page.locator('[data-testid="wb3-prompt-editor"]')).toContainText('提示词')
    const rows = studio.page.locator('[data-testid="wb3-prompt-block-row"]')
    await expect(rows.first()).toBeVisible({ timeout: 20_000 })
    await expect(studio.page.locator('[data-testid="wb3-version-overview"]')).toContainText('第 1 版')

    await rows.filter({ hasText: '渲染风格' }).click()
    const dialog = studio.page.getByRole('dialog')
    await expect(dialog).toContainText('编辑块')
    await dialog.getByLabel('正文').fill('清爽的日系赛璐璐插画，干净线稿，柔和逆光')
    await dialog.getByRole('button', { name: '保存为新版本' }).click()
    await expect(dialog).toBeHidden({ timeout: 30_000 })

    await expect(studio.page.locator('[data-testid="wb3-version-overview"]')).toContainText('第 2 版')
    await expect(studio.page.locator('[data-testid="wb3-prompt-editor"]')).toContainText('柔和逆光')
    await expect(
      studio.page.locator('[data-testid="wb3-prompt-history-row"]').filter({ hasText: '第 2 版' })
    ).toBeVisible()
  } finally {
    await studio.close()
  }
})

test('renames the character and rolls back a prompt version', async () => {
  const studio = await launchStudio('agent2live-v3-rollback-')
  try {
    const api = new ApiClient(studio.endpoint)
    const seeded = await seedWorkbench(api)
    await openWorkbench(studio.page, seeded.character.id, seeded.project.id)

    await studio.page.getByRole('button', { name: '改名', exact: true }).click()
    const rename = studio.page.getByRole('dialog', { name: '改名' })
    await rename.getByLabel('角色名称').fill('霜·改')
    await rename.getByRole('button', { name: '保存', exact: true }).click()
    await expect(rename).toBeHidden({ timeout: 20_000 })
    await expect(studio.page.locator('[data-testid="wb3-prompt-editor"]')).toContainText('霜·改')

    const styleRow = studio.page
      .locator('[data-testid="wb3-prompt-block-row"]')
      .filter({ hasText: '渲染风格' })
    await styleRow.click()
    const blockDialog = studio.page.getByRole('dialog')
    await blockDialog.getByLabel('正文').fill('清爽的日系赛璐璐插画，干净线稿，第二版')
    await blockDialog.getByRole('button', { name: '保存为新版本' }).click()
    await expect(blockDialog).toBeHidden({ timeout: 30_000 })
    await expect(studio.page.locator('[data-testid="wb3-version-overview"]')).toContainText('第 2 版')

    const firstVersion = studio.page
      .locator('[data-testid="wb3-prompt-history-row"]')
      .filter({ hasText: '第 1 版' })
    await firstVersion.getByRole('button', { name: '回到这版', exact: true }).click()
    await expect(studio.page.locator('[data-testid="wb3-version-overview"]')).toContainText('第 3 版', {
      timeout: 30_000
    })

    const overview = studio.page.locator('[data-testid="wb3-version-overview"]')
    await overview.getByRole('button', { name: '查看全部', exact: true }).first().click()
    const gallery = studio.page.getByRole('dialog', { name: '参考图' })
    await expect(gallery).toBeVisible()
    await gallery.getByLabel('权重').fill('1.3')
    await gallery.getByRole('button', { name: '完成', exact: true }).click()
    await expect(gallery).toBeHidden()
    await expect(studio.page.locator('.wb3-actionbar')).toContainText('有未保存修改')

    const secondVersion = studio.page
      .locator('[data-testid="wb3-prompt-history-row"]')
      .filter({ hasText: '第 2 版' })
    await secondVersion.getByRole('button', { name: /第 2 版/ }).click()
    await expect(studio.page.locator('.wb3-actionbar')).toContainText('历史版本只读')
    await expect(studio.page.locator('[data-testid="wb3-prompt-editor"]')).toContainText('第二版')

    await studio.page
      .locator('[data-testid="wb3-prompt-history-row"]')
      .filter({ hasText: '第 1 版' })
      .getByRole('button', { name: '回到这版', exact: true })
      .click()
    const rollbackDialog = studio.page.getByRole('dialog', { name: '回到旧版提示词' })
    await expect(rollbackDialog).toBeVisible()
    await rollbackDialog.getByRole('button', { name: '保存当前并回到此版', exact: true }).click()
    await expect(rollbackDialog).toBeHidden({ timeout: 30_000 })

    await expect(overview).toContainText('第 5 版', { timeout: 30_000 })
    await expect(studio.page.getByRole('alert')).toHaveCount(0)
    await overview.getByRole('button', { name: /更早 2 个版本/ }).click()
    await expect(
      studio.page.locator('[data-testid="wb3-prompt-history-row"]').filter({ hasText: '第 1 版' })
    ).toBeVisible()
    await expect(
      studio.page.locator('[data-testid="wb3-prompt-history-row"]').filter({ hasText: '第 2 版' })
    ).toBeVisible()
    await expect(studio.page.locator('[data-testid="wb3-prompt-history-row"]')).toHaveCount(5)

    const versions = (
      await api.json<{ items: Array<{ id: string; versionNumber: number }> }>(
        'GET',
        `/api/v1/art-projects/${encodeURIComponent(seeded.project.id)}/prompt-versions`
      )
    ).body.items
    const savedCurrent = versions.find((version) => version.versionNumber === 4)
    expect(savedCurrent, 'saving before rollback creates version 4').toBeTruthy()
    const savedVersionDetail = (
      await api.json<{ state: { materialRefs: Array<{ weight: number }> } }>(
        'GET',
        `/api/v1/art-projects/${encodeURIComponent(seeded.project.id)}/prompt-versions/${encodeURIComponent(
          savedCurrent!.id
        )}`
      )
    ).body
    expect(savedVersionDetail.state.materialRefs.map((reference) => reference.weight)).toContain(1.3)

    const rollbackTarget = versions.find((version) => version.versionNumber === 5)
    expect(rollbackTarget, 'rolling back creates version 5').toBeTruthy()
    const rollbackDetail = (
      await api.json<{ state: { materialRefs: Array<{ weight: number }> } }>(
        'GET',
        `/api/v1/art-projects/${encodeURIComponent(seeded.project.id)}/prompt-versions/${encodeURIComponent(
          rollbackTarget!.id
        )}`
      )
    ).body
    expect(rollbackDetail.state.materialRefs.map((reference) => reference.weight)).toContain(1)
  } finally {
    await studio.close()
  }
})

test('applies only the selected AI rewrite operation', async () => {
  const studio = await launchStudio('agent2live-v3-ai-')
  try {
    const api = new ApiClient(studio.endpoint)
    const seeded = await seedWorkbench(api)
    await createChatProvider(api)
    await openWorkbench(studio.page, seeded.character.id, seeded.project.id)

    await studio.page.getByRole('button', { name: 'AI 改写', exact: true }).click()
    const dialog = studio.page.getByRole('dialog')
    await expect(dialog).toContainText('AI 改写')
    await dialog.getByLabel('改法').fill('发色偏冷一点')
    await dialog.getByRole('button', { name: '生成建议', exact: true }).click()

    await expect(dialog.locator('[data-testid="wb3-ai-suggestions"]')).toBeVisible({
      timeout: 30_000
    })
    const operations = dialog.locator('[data-testid="wb3-ai-operation"]')
    await expect(operations).toHaveCount(2)
    await operations.first().getByRole('button', { name: '撤销', exact: true }).click()
    await dialog.getByRole('button', { name: '应用已选 1 条', exact: true }).click()
    await expect(dialog).toBeHidden({ timeout: 30_000 })

    const styleRow = studio.page
      .locator('[data-testid="wb3-prompt-block-row"]')
      .filter({ hasText: '渲染风格' })
    await expect(styleRow).toContainText('×1.2')
    await expect(
      studio.page.locator('[data-testid="wb3-prompt-block-row"]').filter({ hasText: 'AI 建议' })
    ).toHaveCount(0)

    await studio.page.getByRole('button', { name: '提交为新版本', exact: true }).click()
    await expect(studio.page.locator('[data-testid="wb3-version-overview"]')).toContainText('第 2 版', {
      timeout: 30_000
    })
    await expect(
      studio.page.locator('[data-testid="wb3-prompt-block-row"]').filter({ hasText: 'AI 建议' })
    ).toHaveCount(0)
  } finally {
    await studio.close()
  }
})

test('generates candidates through the dialog and saves one as an art version', async () => {
  const studio = await launchStudio('agent2live-v3-generate-')
  try {
    const api = new ApiClient(studio.endpoint)
    const seeded = await seedWorkbench(api)
    await createImageProvider(api)
    await openWorkbench(studio.page, seeded.character.id, seeded.project.id)

    await studio.page.getByRole('button', { name: '生成图片', exact: true }).click()
    const dialog = studio.page.getByRole('dialog', { name: '生成图片' })
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('第 1 版')
    await dialog.getByRole('button', { name: '生成图片', exact: true }).click()

    await expect(studio.page.locator('[data-testid="wb3-candidates-view"]')).toBeVisible({
      timeout: 20_000
    })
    await expect(studio.page.locator('[data-testid="wb3-generation-params"]')).toContainText('张数 4 张')
    const cards = studio.page.locator('[data-testid="wb3-candidate-card"]')
    await expect(cards).toHaveCount(4, { timeout: 30_000 })
    await cards.first().click()
    await studio.page.locator('.wb3-actionbar').getByRole('button', { name: '存为立绘', exact: true }).click()

    await expect(studio.page.locator('[data-testid="wb3-art-version-view"]')).toBeVisible({
      timeout: 20_000
    })
    await expect(studio.page.locator('[data-testid="wb3-art-version-item"]').first()).toContainText('第 1 版')
    await expect(studio.page.locator('[data-testid="wb3-art-version-inspector"]')).toContainText('当前参考')
  } finally {
    await studio.close()
  }
})

test('warns about blocks dropped from generation and discards a batch', async () => {
  const studio = await launchStudio('agent2live-v3-dropped-')
  try {
    const api = new ApiClient(studio.endpoint)
    const seeded = await seedLongPromptWorkbench(api)
    const provider = await createImageProvider(api, 1000)
    const created = await api.createGeneration({
      projectId: seeded.project.id,
      promptVersionId: seeded.version.id,
      providerConnectionId: provider.id,
      count: 2,
      size: '512x896'
    })
    await api.waitForGenerationReady(created.generationId)
    await openWorkbench(studio.page, seeded.character.id, seeded.project.id)

    const banner = studio.page.locator('[data-testid="wb3-dropped-banner"]')
    await expect(banner).toBeVisible({ timeout: 20_000 })
    await expect(banner).toContainText('没有落到第 1 版')

    await studio.page.evaluate(
      (hash) => {
        window.location.hash = hash
      },
      `#/characters/${encodeURIComponent(seeded.character.id)}/art?project=${encodeURIComponent(
        seeded.project.id
      )}&view=candidates&generation=${encodeURIComponent(created.generationId)}`
    )
    await expect(studio.page.locator('[data-testid="wb3-candidates-view"]')).toBeVisible({
      timeout: 20_000
    })
    await studio.page.getByRole('button', { name: '丢弃本批', exact: true }).click()
    const confirm = studio.page.getByRole('dialog', { name: '丢弃本批？' })
    await expect(confirm).toBeVisible()
    await confirm.getByRole('button', { name: '丢弃', exact: true }).click()
    await expect(studio.page.locator('[data-testid="wb3-prompt-view"]')).toBeVisible({
      timeout: 20_000
    })

    const generation = await api.getGeneration(created.generationId)
    expect(generation.candidates.every((candidate) => candidate.status === 'rejected')).toBe(true)
  } finally {
    await studio.close()
  }
})

test('views art versions and restores the three views from the URL', async () => {
  const studio = await launchStudio('agent2live-v3-versions-')
  try {
    const api = new ApiClient(studio.endpoint)
    const seeded = await seedWorkbench(api)
    const provider = await createImageProvider(api)
    const created = await api.createGeneration({
      projectId: seeded.project.id,
      promptVersionId: seeded.version.id,
      providerConnectionId: provider.id,
      count: 1,
      size: '512x896'
    })
    await api.waitForJob(created.jobId)
    const generation = await api.waitForGenerationReady(created.generationId)
    const candidate = generation.candidates.find((entry) => entry.status === 'ready')!
    const project = await api.getProject(seeded.project.id)
    const manual = await api.createManualArtVersion({
      projectId: seeded.project.id,
      assetId: candidate.assetId,
      promptVersionId: seeded.version.id,
      expectedProjectRowVersion: project.rowVersion
    })

    await openWorkbench(
      studio.page,
      seeded.character.id,
      seeded.project.id,
      `&view=versions&artVersion=${encodeURIComponent(manual.artVersion.id)}`
    )
    await expect(studio.page.locator('[data-testid="wb3-art-version-view"]')).toBeVisible({
      timeout: 20_000
    })
    await expect(studio.page.locator('[data-testid="wb3-art-version-list"]')).toContainText('第 1 版')
    await expect(studio.page.locator('[data-testid="wb3-art-version-inspector"]')).toContainText(
      '依据的提示词'
    )
    await expect(studio.page.locator('[data-testid="wb3-art-version-inspector"]')).toContainText('当前参考')
    await studio.page.getByRole('button', { name: '打开分层', exact: true }).click()
    await expect(studio.page.locator('[data-testid="live2d-placeholder"]')).toBeVisible({
      timeout: 20_000
    })

    await openWorkbench(
      studio.page,
      seeded.character.id,
      seeded.project.id,
      `&view=candidates&generation=${encodeURIComponent(created.generationId)}`
    )
    await expect(studio.page.locator('[data-testid="wb3-generation-params"]')).toContainText('依据 第 1 版')
    await studio.page.getByRole('button', { name: /依据 第 1 版/ }).click()
    await expect(studio.page.locator('[data-testid="wb3-prompt-view"]')).toBeVisible({
      timeout: 20_000
    })

    await studio.page.reload()
    await expect(studio.page.locator('[data-testid="wb3-prompt-view"]')).toBeVisible({
      timeout: 20_000
    })
  } finally {
    await studio.close()
  }
})
