import { test, expect } from '@playwright/test'
import { launchStudio } from './helpers/app'
import { ApiClient, type ArtProjectDto } from './helpers/api'
import { goldenPromptState, makePng } from './helpers/seed'
import { captureVisual, lintStudioTokens, scanAxe, resizeToBaseline, type AxePageResult } from './helpers/axe'
import { evidenceRelativePath, writeEvidenceJson } from './helpers/evidence'
import { UI_EVIDENCE_PAGES } from '../scripts/phase1-gate.mjs'

const UI_PAGES = UI_EVIDENCE_PAGES

async function seedArtwork(
  api: ApiClient,
  project: ArtProjectDto,
  providerId: string,
  seed: number,
  ifMatchRowVersion?: number
): Promise<{
  projectId: string
  generationId: string
  activeArtVersionId: string
}> {
  const input = await api.uploadPromptInput(project.id, await makePng(), {
    filename: 'ui-reference.png',
    ...(ifMatchRowVersion === undefined ? {} : { ifMatchRowVersion })
  })
  const assetId = input.submission.materials[0]!.assetId
  const draft = await api.savePromptDraft(
    project.id,
    input.draft.id,
    goldenPromptState(assetId),
    input.draft.rowVersion
  )
  const committed = await api.commitPromptDraft(project.id, draft.id, draft.rowVersion)
  const created = await api.createGeneration({
    projectId: project.id,
    promptVersionId: committed.version.id,
    providerConnectionId: providerId,
    count: 4,
    size: '512x896',
    seed
  })
  await api.waitForJob(created.jobId)
  const generation = await api.waitForGenerationReady(created.generationId)
  const first = generation.candidates.find((candidate) => candidate.status === 'ready')
  if (!first) throw new Error('UI evidence generation produced no ready candidate')
  const currentProject = await api.getProject(project.id)
  const manual = await api.createManualArtVersion({
    projectId: project.id,
    assetId: first.assetId,
    promptVersionId: committed.version.id,
    expectedProjectRowVersion: currentProject.rowVersion
  })
  return {
    projectId: project.id,
    generationId: created.generationId,
    activeArtVersionId: manual.artVersion.id
  }
}

test('captures axe, token lint, and 1440x900 visual baselines', async () => {
  test.setTimeout(240_000)
  const studio = await launchStudio('agent2live-ui-evidence-')
  try {
    const { page, endpoint } = studio
    const api = new ApiClient(endpoint)
    await page.locator('[data-testid="studio-ready"]').waitFor({
      state: 'visible',
      timeout: 30_000
    })
    await expect(page.locator('[data-testid="studio-global-status"]')).toContainText('实时已连接', {
      timeout: 20_000
    })
    await resizeToBaseline(studio.app, page)

    const imageProvider = await api.createMockImageProvider()
    const overviewProjects: ArtProjectDto[] = []
    for (const title of ['昀', '砚', '灯']) {
      const character = await api.createCharacter(title, `${title} 的视觉基线角色简介。`)
      overviewProjects.push(await api.createProject(character.id, `${title} 的默认造型`, '视觉基线项目'))
    }
    await seedArtwork(api, overviewProjects.at(-1)!, imageProvider.id, 20261111)
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
    const references = await Promise.all(
      ['#b8d7cc', '#d8ebe2', '#c9d8e8', '#dcc9e8', '#e8d5c9', '#d7dcc9'].map((color, index) =>
        makePng(240, 320, color).then((buffer) => ({
          name: `reference-${index + 1}.png`,
          mimeType: 'image/png',
          buffer
        }))
      )
    )
    await page.getByLabel('上传参考图').setInputFiles(references)
    await expect(page.locator('[data-testid="character-reference-card"]')).toHaveCount(6)
    await expect(page.getByText('6 张已满，删除一张后继续上传')).toBeVisible()
    await page.mouse.move(0, 0)
    await capture('new-character-full')

    const hoverCard = page.locator('[data-testid="character-reference-card"]').nth(1)
    await hoverCard.hover()
    await expect(hoverCard.getByTestId('reference-hover-actions')).toHaveCSS('opacity', '1')
    await capture('reference-hover')
    const editReference = hoverCard.getByRole('button', { name: '编辑', exact: true })
    await editReference.focus()
    await page.keyboard.press('Enter')
    const referenceEditor = page.getByRole('dialog', { name: '参考图' })
    await expect(referenceEditor).toBeVisible()
    await expect
      .poll(() =>
        referenceEditor
          .getByRole('img', { name: 'reference-2.png' })
          .evaluate((image) => (image as HTMLImageElement).naturalWidth)
      )
      .toBeGreaterThan(0)
    await capture('reference-editor')
    await referenceEditor.getByRole('button', { name: '取消', exact: true }).click()

    await page.getByRole('button', { name: '创建并生成', exact: true }).click()
    await expect(page.locator('[data-testid="character-created"]')).toBeVisible({
      timeout: 30_000
    })
    await capture('created-confirmation')
    await page.getByTestId('open-character-card').click()
    await expect(page.locator('[data-testid="character-just-created"]')).toBeVisible()
    await capture('character-just-created')
    await page.getByTestId('open-art-workbench').click()
    await expect(page.locator('[data-testid="art-workbench"]')).toBeVisible({ timeout: 30_000 })
    const segments = new URL(page.url()).hash.slice(2).split('/').filter(Boolean)
    const characterId = decodeURIComponent(segments[1] ?? '')
    expect(characterId).toMatch(/^chr_/)
    const projectId = new URL(page.url()).hash.match(/[?&]project=([^&]+)/)?.[1]
    expect(projectId).toMatch(/^artp_/)

    await expect(page.locator('.workbench-design-version-tree')).toHaveCSS('width', '220px')
    await expect(page.locator('.workbench-design-inspector')).toHaveCSS('width', '320px')
    await expect(page.locator('.workbench-design-topbar')).toHaveCSS('height', '48px')
    await expect(page.locator('[data-testid="workbench-reference-card"]')).toHaveCount(6)
    await expect(page.locator('[data-testid="workbench-reference-card"]').first()).toHaveCSS('width', '255px')
    await expect(page.getByLabel('完整提示词')).toHaveValue(/UI 基线角色/)
    const creationWorkspace = await api.json<{
      activeDraft: { state: { fullPrompt: string } } | null
    }>('GET', `/api/v1/art-projects/${encodeURIComponent(projectId!)}/prompt`)
    expect(creationWorkspace.body.activeDraft?.state.fullPrompt).toContain('UI 基线角色')
    await capture('workbench-references')

    const workspace = (
      await api.json<{
        activeDraft: { rowVersion: number } | null
      }>('GET', `/api/v1/art-projects/${encodeURIComponent(projectId!)}/prompt`)
    ).body
    const seeded = await seedArtwork(
      api,
      await api.getProject(projectId!),
      imageProvider.id,
      20261112,
      workspace.activeDraft?.rowVersion
    )
    await page.evaluate((id) => {
      window.location.hash = `#/characters/${encodeURIComponent(id)}`
    }, characterId)
    await expect(page.getByRole('heading', { name: '凛', level: 1 })).toBeVisible()
    await expect(page.locator('[data-testid="project-card"]').filter({ hasText: '默认造型' })).toBeVisible({
      timeout: 20_000
    })
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
    await expect(
      page.locator(`[data-testid="workbench-version-node"][data-version-id="${seeded.activeArtVersionId}"]`)
    ).toHaveAttribute('data-active', 'true')
    await page.getByRole('button', { name: '候选', exact: true }).click()
    await expect(page.locator('[data-testid="generation-status"]')).toBeVisible({ timeout: 20_000 })
    await expect(page.locator('[data-testid="candidate-compare"]')).toBeVisible({ timeout: 20_000 })
    await expect(page.locator('[data-testid="candidate-card"] img').first()).toBeVisible({
      timeout: 20_000
    })
    await expect(page.getByRole('button', { name: '候选', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    await expect(page.locator('[data-testid="candidate-card"]')).toHaveCSS('width', '427px')
    await expect(page.locator('[data-testid="candidate-strip"]')).toHaveCSS('width', '350px')
    await expect(page.locator('[data-testid="candidate-strip"]')).toContainText('4 张')
    await expect(page.locator('[data-testid="candidate-card"]')).toContainText('候选 A')
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
