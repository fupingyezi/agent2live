import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { ApiClient } from './helpers/api'
import { launchStudio } from './helpers/app'
import { goldenPromptState, makePng } from './helpers/seed'
import { studioPage } from './support/windows'

type StudioPage = Awaited<ReturnType<typeof studioPage>>

async function expectSharedNavigation(studio: StudioPage): Promise<void> {
  const nav = studio.getByRole('navigation', { name: '主导航' })
  await expect(nav).toHaveCSS('width', '64px')

  const brand = studio.getByTestId('studio-nav-brand')
  await expect(brand).toHaveCSS('width', '32px')
  await expect(brand).toHaveCSS('height', '32px')
  expect(await brand.evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)

  const items = nav.getByRole('button')
  await expect(items).toHaveCount(5)
  for (const name of ['角色', '桌宠', 'Agent', '模型库', '设置']) {
    const item = studio.getByRole('button', { name, exact: true })
    await expect(item).toHaveCSS('width', '50px')
    await expect(item).toHaveCSS('height', '50px')
  }
  await expect(studio.getByRole('button', { name: '桌宠', exact: true })).toBeDisabled()
  await expect(studio.getByRole('button', { name: 'Agent', exact: true })).toBeDisabled()
  await expect(studio.getByRole('button', { name: '模型库', exact: true })).toBeDisabled()

  const icons = studio.getByTestId('studio-nav-icons').locator('img')
  await expect(icons).toHaveCount(5)
  for (const icon of await icons.all()) {
    await expect(icon).toHaveCSS('width', '24px')
    await expect(icon).toHaveCSS('height', '24px')
    expect(await icon.evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
  }
}

test('creates a character and art project, streams events, and survives reload', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'agent2live-studio-shell-'))
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
    await expect(
      studio.locator('[data-testid="studio-global-status"]').locator('[data-state="success"]')
    ).toHaveCount(1)
    await expect(studio.locator('[data-testid="studio-breadcrumb"]')).toContainText('角色')
    await expect(studio.getByTestId('studio-page-topbar')).toHaveCount(1)
    await expect(studio.getByTestId('studio-page-topbar')).toHaveCSS('height', '56px')
    await expectSharedNavigation(studio)
    const characterNav = studio.getByRole('button', { name: '角色', exact: true })
    await expect(characterNav).toHaveAttribute('aria-current', 'page')
    await expect(characterNav).toHaveCSS('background-color', 'rgb(239, 250, 247)')

    const providerNav = studio.getByRole('button', { name: '设置', exact: true })
    await providerNav.focus()
    await expect(providerNav).toBeFocused()
    await providerNav.press('Enter')
    await expect(studio.getByRole('heading', { name: '模型供应商', level: 1 })).toBeVisible()
    await expect(providerNav).toHaveAttribute('aria-current', 'page')
    await expect(providerNav).toHaveCSS('background-color', 'rgb(239, 250, 247)')
    await expect(studio.getByTestId('studio-page-topbar')).toHaveCount(0)
    await studio.getByRole('button', { name: '角色', exact: true }).click()

    const accent = await studio.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--a2l-color-accent').trim()
    )
    expect(accent).toBe('#1f826f')

    await studio.getByRole('link', { name: '新建角色', exact: true }).click()
    await expect(studio.getByRole('heading', { name: '新建角色', level: 1 })).toBeVisible()
    await expect(studio.getByTestId('studio-page-topbar')).toHaveCount(0)
    await studio.getByLabel('角色名称').fill('凛')
    await studio.getByLabel('角色简介').fill('黑发、冷静、带一点疏离感的年轻剑士。')
    await studio.getByRole('button', { name: '创建并生成' }).click()

    await expect(studio.locator('[data-testid="art-workbench"]')).toBeVisible({ timeout: 30_000 })
    await expect(studio.getByRole('heading', { name: '默认造型', level: 1 })).toBeVisible()
    await expect(studio.locator('[data-testid="prompt-block-list"]')).toBeVisible({
      timeout: 20_000
    })
    await expect(studio.getByTestId('studio-page-topbar')).toHaveCount(0)
    await expect.poll(() => studio.url()).toContain('project=artp_')
    const projectUrl = studio.url()

    await studio.reload()
    await expect(studio.locator('[data-testid="studio-ready"]')).toBeVisible()
    await expect(studio.locator('[data-testid="studio-global-status"]')).toContainText('实时已连接', {
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
    await studio.getByRole('button', { name: '创建并生成', exact: true }).click()

    await expect(studio.locator('[data-testid="art-workbench"]')).toBeVisible({ timeout: 30_000 })
    await expect(studio.locator('[data-testid="prompt-block-list"]')).toBeVisible({ timeout: 20_000 })
    await expect(studio.locator('[data-testid="material-tray"]')).toContainText('身份参考')
    await expect(studio.locator('[data-testid="material-tray"]')).toContainText('风格参考')
  } finally {
    await app.close()
  }
})

test('restores the character overview from projects and active art versions', async () => {
  test.setTimeout(120_000)
  const studio = await launchStudio('agent2live-overview-')

  try {
    const api = new ApiClient(studio.endpoint)
    const withoutProject = await api.createCharacter('灯', '还没有美术项目的角色。')
    const awaitingArt = await api.createCharacter('砚', '已经有项目，但还没有立绘。')
    await api.createProject(awaitingArt.id, '默认造型', '等待首张立绘。')
    const featured = await api.createCharacter('霜', '银白长发、绿色眼睛，安静但会主动替人遮雨的剑士。')
    const featuredProject = await api.createProject(featured.id, '默认造型', '已有一张主参考图。')

    const referenceBytes = await makePng(320, 480, '#d8ebe2')
    const input = await api.uploadPromptInput(featuredProject.id, referenceBytes, {
      filename: 'overview-reference.png'
    })
    const referenceAssetId = input.submission.materials[0]!.assetId
    const draft = await api.savePromptDraft(
      featuredProject.id,
      input.draft.id,
      goldenPromptState(referenceAssetId),
      input.draft.rowVersion
    )
    const committed = await api.commitPromptDraft(featuredProject.id, draft.id, draft.rowVersion)
    const artAsset = await api.uploadAsset(
      await makePng(512, 768, '#b8d7cc'),
      'image/png',
      'overview-art.png'
    )
    const artwork = await api.createManualArtVersion({
      projectId: featuredProject.id,
      assetId: artAsset.id,
      promptVersionId: committed.version.id,
      expectedProjectRowVersion: committed.project.rowVersion
    })
    expect(artwork.project.activeVersionId).toBe(artwork.artVersion.id)

    await studio.page.reload()
    await expect(studio.page.locator('[data-testid="studio-ready"]')).toBeVisible()
    const hero = studio.page.locator('[data-testid="character-overview-hero"]')
    await expect(hero).toHaveAttribute('data-character-id', featured.id)
    await expect(hero).toContainText(featured.title)

    const cards = studio.page.locator('[data-testid="character-card"]')
    await expect(cards).toHaveCount(3)
    await expect(cards.nth(0)).toHaveAttribute('data-character-id', featured.id)
    await expect(cards.nth(1)).toHaveAttribute('data-character-id', awaitingArt.id)
    await expect(cards.nth(2)).toHaveAttribute('data-character-id', withoutProject.id)

    const featuredCard = studio.page.locator(
      `[data-testid="character-card"][data-character-id="${featured.id}"]`
    )
    const featuredImage = featuredCard.locator('img')
    await expect(featuredImage).toHaveAttribute('data-asset-id', artAsset.id)
    await expect
      .poll(() => featuredImage.evaluate((image) => (image as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0)

    const awaitingCard = studio.page.locator(
      `[data-testid="character-card"][data-character-id="${awaitingArt.id}"]`
    )
    await expect(awaitingCard).toContainText('还没有立绘')
    await expect(awaitingCard).toContainText('「这里还空着呀。」写一句话试试。')
    const awaitingEmptyArt = awaitingCard.getByRole('img', { name: '等待立绘的看板娘' })
    await expect(awaitingEmptyArt).toBeVisible()
    await expect
      .poll(() => awaitingEmptyArt.evaluate((image) => (image as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0)
    const withoutProjectCard = studio.page.locator(
      `[data-testid="character-card"][data-character-id="${withoutProject.id}"]`
    )
    await expect(withoutProjectCard).toContainText('尚未开始')
    await expect(withoutProjectCard).toContainText('从一句话开始，不用先准备素材')
    const withoutProjectEmptyArt = withoutProjectCard.getByRole('img', {
      name: '等待立绘的看板娘'
    })
    await expect(withoutProjectEmptyArt).toBeVisible()
    await expect
      .poll(() => withoutProjectEmptyArt.evaluate((image) => (image as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0)
  } finally {
    await studio.close()
  }
})

test('creates a default art project and prompt draft from text-only setup', async () => {
  test.setTimeout(120_000)
  const studio = await launchStudio('agent2live-text-bootstrap-')

  try {
    await studio.page.getByRole('link', { name: '新建角色', exact: true }).click()
    await studio.page.getByLabel('角色名称').fill('霁')
    await studio.page
      .getByLabel('角色简介')
      .fill('住在旧城钟楼里的年轻抄写员，说话轻，习惯把重要的事写进页边。')
    await studio.page.getByLabel('补充说明').fill('围巾始终可见，画面保持低饱和。')
    await studio.page.reload()
    await expect(studio.page.getByLabel('角色名称')).toHaveValue('霁')
    await expect(studio.page.getByLabel('角色简介')).toHaveValue(
      '住在旧城钟楼里的年轻抄写员，说话轻，习惯把重要的事写进页边。'
    )
    await expect(studio.page.getByRole('button', { name: '创建并生成' })).toBeVisible()
    await studio.page.getByRole('button', { name: '创建并生成' }).click()

    await expect(studio.page.locator('[data-testid="art-workbench"]')).toBeVisible({
      timeout: 30_000
    })
    await expect.poll(() => studio.page.url()).toContain('/art?project=artp_')
    await expect(studio.page.locator('[data-testid="prompt-block-list"]')).toBeVisible({
      timeout: 20_000
    })
    await expect(studio.page.locator('[data-testid="prompt-block-list"]')).toContainText('霁')
    await expect(studio.page.locator('[data-testid="no-active-draft"]')).toHaveCount(0)
    await expect(studio.page.getByText('新建美术项目', { exact: true })).toHaveCount(0)

    const inputPanel = studio.page.locator('[data-testid="prompt-input-panel"]')
    await inputPanel.getByRole('button', { name: '展开', exact: true }).click()
    const overallNotes = inputPanel.getByLabel('整体说明')
    await expect(overallNotes).toHaveValue(
      '住在旧城钟楼里的年轻抄写员，说话轻，习惯把重要的事写进页边。\n\n围巾始终可见，画面保持低饱和。'
    )
  } finally {
    await studio.close()
  }
})

test('recovers when prompt input submission fails after project creation', async () => {
  test.setTimeout(120_000)
  const studio = await launchStudio('agent2live-bootstrap-recovery-')

  try {
    await studio.page.route('**/api/v1/art-projects/*/prompt-inputs', async (route) => {
      await route.fulfill({
        status: 503,
        contentType: 'application/problem+json',
        body: JSON.stringify({
          type: 'about:blank',
          title: '模拟输入提交失败',
          status: 503,
          code: 'TEST_BOOTSTRAP_FAILED'
        })
      })
    })

    await studio.page.getByRole('link', { name: '新建角色', exact: true }).click()
    await studio.page.getByLabel('角色名称').fill('岚')
    await studio.page.getByLabel('角色简介').fill('用于验证创建失败后的恢复入口。')
    await studio.page.getByRole('button', { name: '创建并生成' }).click()

    await expect(studio.page.getByRole('alert')).toContainText('HTTP 503')
    await expect(studio.page.getByRole('link', { name: '进入角色卡片' })).toBeVisible()
    await expect(studio.page.getByRole('link', { name: '打开默认造型' })).toBeVisible()
    await expect(studio.page.getByRole('button', { name: '重新提交输入' })).toBeVisible()

    await studio.page.unroute('**/api/v1/art-projects/*/prompt-inputs')
    await studio.page.getByRole('button', { name: '重新提交输入' }).click()
    await expect(studio.page.locator('[data-testid="art-workbench"]')).toBeVisible({
      timeout: 30_000
    })
    await expect(studio.page.locator('[data-testid="prompt-block-list"]')).toBeVisible({
      timeout: 20_000
    })
  } finally {
    await studio.close()
  }
})
