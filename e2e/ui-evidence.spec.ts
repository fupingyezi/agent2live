import { test, expect } from '@playwright/test'
import { launchStudio } from './helpers/app'
import { ApiClient } from './helpers/api'
import { goldenPromptState, makePng } from './helpers/seed'
import { captureVisual, lintStudioTokens, scanAxe, resizeToBaseline, type AxePageResult } from './helpers/axe'
import { evidenceRelativePath, writeEvidenceJson } from './helpers/evidence'

const UI_PAGES = [
  'overview',
  'new-character-empty',
  'new-character-full',
  'character-card',
  'workbench-references',
  'workbench-candidates',
  'providers'
] as const

async function seedWorkbench(
  api: ApiClient,
  characterId: string
): Promise<{
  projectId: string
  generationId: string
  activeArtVersionId: string
}> {
  const project = await api.createProject(characterId, '视觉基线项目', 'G1-UI 证据数据')
  const input = await api.uploadPromptInput(project.id, await makePng(), {
    filename: 'ui-reference.png'
  })
  const assetId = input.submission.materials[0]!.assetId
  const draft = await api.savePromptDraft(
    project.id,
    input.draft.id,
    goldenPromptState(assetId),
    input.draft.rowVersion
  )
  const committed = await api.commitPromptDraft(project.id, draft.id, draft.rowVersion)
  const provider = await api.createMockImageProvider()
  const created = await api.createGeneration({
    projectId: project.id,
    promptVersionId: committed.version.id,
    providerConnectionId: provider.id,
    count: 2,
    size: '512x896',
    seed: 20261112
  })
  await api.waitForJob(created.jobId)
  const generation = await api.waitForGenerationReady(created.generationId)
  const first = generation.candidates.find((candidate) => candidate.status === 'ready')
  if (!first) throw new Error('UI evidence generation produced no ready candidate')
  const accepted = await api.acceptCandidate(first.id, null)
  return {
    projectId: project.id,
    generationId: created.generationId,
    activeArtVersionId: accepted.artVersion.id
  }
}

test('captures axe, token lint, and 1440x900 visual baselines', async () => {
  test.setTimeout(180_000)
  const studio = await launchStudio('agent2live-ui-evidence-')
  try {
    const { page, endpoint } = studio
    const api = new ApiClient(endpoint)
    await page.locator('[data-testid="studio-ready"]').waitFor({
      state: 'visible',
      timeout: 30_000
    })
    await expect(page.locator('[data-testid="sse-status"]')).toContainText('实时已连接', {
      timeout: 20_000
    })
    await resizeToBaseline(studio.app, page)

    for (const title of ['昀', '砚', '灯']) {
      const character = await api.createCharacter(title, `${title} 的视觉基线角色简介。`)
      await api.createProject(character.id, `${title} 的默认造型`, '视觉基线项目')
    }
    await page.reload()
    await page.locator('[data-testid="studio-ready"]').waitFor({ state: 'visible', timeout: 30_000 })

    const axePages: AxePageResult[] = []
    const visualPaths: string[] = []
    const capture = async (name: (typeof UI_PAGES)[number]): Promise<void> => {
      const shot = await captureVisual(studio.app, page, name)
      await expect(page).toHaveScreenshot(`${name}-1440x900.png`, {
        animations: 'disabled',
        scale: 'css',
        maxDiffPixelRatio: 0.01,
        threshold: 0.2
      })
      visualPaths.push(evidenceRelativePath(shot))
      axePages.push(await scanAxe(page, name))
    }

    await expect(page.getByRole('link', { name: '新建角色', exact: true })).toBeVisible()
    await capture('overview')

    await page.getByRole('link', { name: '新建角色', exact: true }).click()
    await expect(page.getByLabel('角色名称')).toBeVisible()
    await capture('new-character-empty')

    await page.getByLabel('角色名称').fill('凛')
    await page.getByLabel('角色简介').fill('UI 基线角色：银白长发、蓝色眼睛，清爽赛璐璐。')
    await capture('new-character-full')

    await page.getByRole('button', { name: '创建角色', exact: true }).click()
    await expect(page.getByRole('heading', { name: '凛', level: 1 })).toBeVisible()
    const segments = new URL(page.url()).hash.slice(2).split('/').filter(Boolean)
    const characterId = decodeURIComponent(segments[1] ?? '')
    expect(characterId).toMatch(/^chr_/)

    const seeded = await seedWorkbench(api, characterId)
    await page.evaluate((id) => {
      window.location.hash = `#/characters/${encodeURIComponent(id)}`
    }, characterId)
    await expect(page.getByRole('heading', { name: '凛', level: 1 })).toBeVisible()
    await expect(
      page.locator('[data-testid="project-card"]').filter({ hasText: '视觉基线项目' })
    ).toBeVisible({ timeout: 20_000 })
    await capture('character-card')
    await page.evaluate(
      ({ projectId, generationId }) => {
        window.localStorage.setItem(`agent2live:last-generation:${projectId}`, generationId)
      },
      { projectId: seeded.projectId, generationId: seeded.generationId }
    )
    await page.evaluate(
      (hash) => {
        window.location.hash = hash
      },
      `#/characters/${encodeURIComponent(characterId)}/art?project=${encodeURIComponent(seeded.projectId)}`
    )

    await expect(page.locator('[data-testid="art-workbench"]')).toBeVisible({ timeout: 20_000 })
    await expect(page.locator('[data-testid="workbench"]')).toBeVisible({ timeout: 20_000 })
    await expect(page.locator('[data-testid="art-version-panel"]')).toHaveAttribute(
      'data-active-version-id',
      seeded.activeArtVersionId
    )
    await capture('workbench-references')

    await page.getByRole('tab', { name: '生成', exact: true }).click()
    await expect(page.locator('[data-testid="generation-status"]')).toBeVisible({ timeout: 20_000 })
    await expect(page.locator('[data-testid="candidate-compare"]')).toBeVisible({ timeout: 20_000 })
    await expect(page.locator('[data-testid="candidate-card"] img').first()).toBeVisible({
      timeout: 20_000
    })
    await capture('workbench-candidates')

    await page.getByRole('button', { name: '设置', exact: true }).click()
    await expect(page.locator('[data-testid="providers-page"]')).toBeVisible()
    await expect(page.locator('[data-testid="provider-card"]')).toHaveCount(1)
    await capture('providers')

    const tokenLint = lintStudioTokens(process.cwd())
    const axePassed = axePages.every((entry) => entry.status === 'pass')
    writeEvidenceJson('ui/axe.json', {
      schemaVersion: 'ui-axe/1',
      status: axePassed ? 'pass' : 'fail',
      generatedAt: new Date().toISOString(),
      viewport: { width: 1440, height: 900 },
      pages: axePages,
      visualBaselines: visualPaths,
      checks: { axePassed }
    })
    writeEvidenceJson('ui/token-lint.json', tokenLint)

    expect(axePages.filter((entry) => entry.status !== 'pass')).toEqual([])
    expect(tokenLint.violations).toEqual([])
  } finally {
    await studio.close()
  }
})
