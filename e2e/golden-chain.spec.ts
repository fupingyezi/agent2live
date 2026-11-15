import { test, expect, type Page } from '@playwright/test'
import { launchStudio } from './helpers/app'
import { ApiClient } from './helpers/api'
import { goldenPromptState, makePng } from './helpers/seed'
import { evidenceRelativePath, sha256Bytes, writeEvidenceBytes, writeEvidenceJson } from './helpers/evidence'

function hashRoute(page: Page): URL {
  const pageUrl = new URL(page.url())
  if (!pageUrl.hash.startsWith('#/')) {
    throw new Error(`expected a hash route, got ${pageUrl.href}`)
  }
  return new URL(pageUrl.hash.slice(1), 'http://studio.local')
}

test('素材到多参考 ArtVersion、回退、Fork 与备份的完整黄金链路', async () => {
  test.setTimeout(180_000)
  const studio = await launchStudio('agent2live-golden-chain-')
  try {
    const { page, endpoint } = studio
    const api = new ApiClient(endpoint)
    const checks: Record<string, boolean> = {
      uiCharacterAndProjectCreated: false,
      characterBriefCreated: false,
      promptInputsIngested: false,
      draftSavedAndCommitted: false,
      mockProviderCreated: false,
      generationSucceeded: false,
      candidateAccepted: false,
      manualVersionCreated: false,
      referenceRevisionCreated: false,
      rollbackActivated: false,
      artVersionForked: false,
      forkCopiedOrderedReferences: false,
      backupCompleted: false,
      backupDownloadVerified: false,
      cockpitVerified: false,
      workbenchVerified: false
    }

    await expect(page.locator('[data-testid="studio-global-status"]')).toContainText('实时已连接', {
      timeout: 20_000
    })

    await page.getByRole('link', { name: '新建角色', exact: true }).click()
    await page.getByLabel('角色名称').fill('凛')
    await page.getByLabel('角色简介').fill('黄金链路测试角色')
    await page.getByRole('button', { name: '创建并生成', exact: true }).click()
    await expect(page.locator('[data-testid="character-created"]')).toBeVisible({
      timeout: 30_000
    })
    await page.getByTestId('open-art-workbench').click()
    await expect(page.locator('[data-testid="art-workbench"]')).toBeVisible({ timeout: 30_000 })

    const characterSegments = hashRoute(page).pathname.split('/').filter(Boolean)
    const characterId = decodeURIComponent(characterSegments[1] ?? '')
    expect(characterId).toMatch(/^chr_/)

    await expect(page.locator('[data-testid="workbench"]')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByRole('heading', { name: '默认造型', level: 1 })).toBeVisible()

    const projectId = hashRoute(page).searchParams.get('project')
    expect(projectId).toMatch(/^artp_/)
    const projectBeforeInput = await api.getProject(projectId!)
    expect(projectBeforeInput.characterId).toBe(characterId)
    checks.uiCharacterAndProjectCreated = true

    const workspace = (
      await api.json<{
        activeDraft: { id: string; rowVersion: number } | null
      }>('GET', `/api/v1/art-projects/${encodeURIComponent(projectId!)}/prompt`)
    ).body
    expect(workspace.activeDraft).not.toBeNull()

    const inputPng = await makePng()
    const promptInput = await api.uploadPromptInput(projectId!, inputPng, {
      ifMatchRowVersion: workspace.activeDraft!.rowVersion,
      filename: 'face-reference.png',
      characterBrief: {
        schemaVersion: 'character-brief/1',
        identity: { fullName: '凛' },
        appearance: { hair: '银白长发', eyes: '蓝色眼睛' },
        behavior: { bodyLanguage: '冷静、自然下垂' }
      }
    })
    expect(promptInput.submission.artProjectId).toBe(projectId)
    expect(promptInput.submission.materials).toHaveLength(1)
    expect(promptInput.submission.characterBriefVersionId).toMatch(/^cbv_/)
    const characterBriefVersionId = promptInput.submission.characterBriefVersionId!
    const projectedBlocks =
      (
        promptInput.draft.state as {
          blocks?: Array<{ source?: string; locked?: boolean }>
        }
      ).blocks ?? []
    expect(projectedBlocks.some((block) => block.source === 'character-brief' && block.locked === true)).toBe(
      true
    )
    checks.characterBriefCreated = true
    expect(Array.isArray(promptInput.warnings)).toBe(true)
    const assetId = promptInput.submission.materials[0]!.assetId
    expect(assetId).toMatch(/^ast_/)
    checks.promptInputsIngested = true

    const savedDraft = await api.savePromptDraft(
      projectId!,
      promptInput.draft.id,
      goldenPromptState(assetId),
      promptInput.draft.rowVersion
    )
    const committed = await api.commitPromptDraft(projectId!, savedDraft.id, savedDraft.rowVersion)
    expect(committed.version.versionNumber).toBe(1)
    expect(committed.version.artProjectId).toBe(projectId)
    expect(committed.project.activePromptVersionId).toBe(committed.version.id)
    expect(committed.project.activeVersionId).toBeNull()
    checks.draftSavedAndCommitted = true

    const provider = await api.createMockImageProvider()
    expect(provider.kind).toBe('image')
    expect(provider.adapter).toBe('mock')
    expect(provider.enabled).toBe(true)
    expect(provider.hasSecret).toBe(false)
    checks.mockProviderCreated = true

    const created = await api.createGeneration({
      projectId: projectId!,
      promptVersionId: committed.version.id,
      providerConnectionId: provider.id,
      count: 1,
      size: '512x896',
      seed: 20261109
    })
    expect(created.requestHash).toMatch(/^[0-9a-f]{64}$/)
    const generationJob = await api.waitForJob(created.jobId)
    expect(generationJob.type).toBe('image.generate')
    expect(generationJob.status).toBe('succeeded')
    const generation = await api.waitForGenerationReady(created.generationId)
    const candidate = generation.candidates.find((item) => item.status === 'ready')
    expect(candidate).toBeTruthy()
    expect(candidate!.asset).not.toBeNull()
    expect(candidate!.asset!.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(candidate!.asset!.mediaType).toBe('image/png')
    checks.generationSucceeded = true

    const accepted = await api.acceptCandidate(candidate!.id, null)
    const firstArtVersion = accepted.artVersion
    expect(firstArtVersion.versionNumber).toBe(1)
    expect(firstArtVersion.parentVersionId).toBeNull()
    expect(firstArtVersion.originVersionId).toBe(firstArtVersion.id)
    expect(firstArtVersion.references).toHaveLength(1)
    expect(firstArtVersion.references[0]).toMatchObject({
      assetId: candidate!.assetId,
      isPrimary: true,
      sortOrder: 0
    })
    expect(firstArtVersion.source).toMatchObject({
      kind: 'generation_candidate',
      candidateId: candidate!.id
    })
    expect(accepted.project.activeVersionId).toBe(firstArtVersion.id)
    checks.candidateAccepted = true

    const manualAssetBytes = await makePng(320, 480, '#d9a6b8')
    const manualAsset = await api.uploadAsset(manualAssetBytes, 'image/png', 'manual-v2.png')
    expect(manualAsset.id).not.toBe(assetId)
    const manual = await api.createManualArtVersion({
      projectId: projectId!,
      assetId: manualAsset.id,
      promptVersionId: committed.version.id,
      expectedProjectRowVersion: accepted.project.rowVersion
    })
    const secondArtVersion = manual.artVersion
    expect(secondArtVersion.versionNumber).toBe(2)
    expect(secondArtVersion.parentVersionId).toBe(firstArtVersion.id)
    expect(secondArtVersion.originVersionId).toBe(firstArtVersion.id)
    expect(secondArtVersion.source).toMatchObject({ kind: 'manual_upload' })
    expect(secondArtVersion.references).toHaveLength(1)
    expect(secondArtVersion.references[0]).toMatchObject({
      assetId: manualAsset.id,
      isPrimary: true,
      sortOrder: 0
    })
    expect(manual.project.activeVersionId).toBe(secondArtVersion.id)
    checks.manualVersionCreated = true

    const auxAssetBytes = await makePng(256, 256, '#9fc7d8')
    const auxAsset = await api.uploadAsset(auxAssetBytes, 'image/png', 'aux-reference.png')
    expect(auxAsset.id).not.toBe(manualAsset.id)
    expect(auxAsset.id).not.toBe(assetId)

    const revised = await api.reviseArtVersionReferences({
      versionId: secondArtVersion.id,
      reason: 'add',
      references: [
        {
          assetId: manualAsset.id,
          role: 'identity_reference',
          note: '主参考：脸型与发色',
          weight: 1,
          sortOrder: 0,
          isPrimary: true,
          locked: false
        },
        {
          assetId: auxAsset.id,
          role: 'style_reference',
          note: '柔光与配色',
          weight: 0.8,
          sortOrder: 1,
          isPrimary: false,
          locked: true
        }
      ],
      expectedProjectRowVersion: manual.project.rowVersion
    })
    const thirdArtVersion = revised.artVersion
    expect(thirdArtVersion.versionNumber).toBe(3)
    expect(thirdArtVersion.parentVersionId).toBe(secondArtVersion.id)
    expect(thirdArtVersion.originVersionId).toBe(firstArtVersion.id)
    expect(
      thirdArtVersion.references.map((reference) => [
        reference.assetId,
        reference.role,
        reference.sortOrder,
        reference.isPrimary,
        reference.locked
      ])
    ).toEqual([
      [manualAsset.id, 'identity_reference', 0, true, false],
      [auxAsset.id, 'style_reference', 1, false, true]
    ])
    expect(thirdArtVersion.references.map((reference) => reference.assetId)).toEqual([
      manualAsset.id,
      auxAsset.id
    ])
    expect(new Set(thirdArtVersion.references.map((reference) => reference.assetId)).size).toBe(
      thirdArtVersion.references.length
    )
    expect(revised.project.activeVersionId).toBe(thirdArtVersion.id)
    expect(revised.project.rowVersion).toBe(manual.project.rowVersion + 1)
    const snapshot = await api.getArtVersions(projectId!)
    expect(snapshot.items.map((item) => item.versionNumber)).toEqual([3, 2, 1])
    expect(snapshot.items.find((item) => item.id === secondArtVersion.id)!.references).toHaveLength(1)
    expect(snapshot.items.find((item) => item.id === thirdArtVersion.id)!.references).toHaveLength(2)
    checks.referenceRevisionCreated = true

    const fork = await api.forkFromArtVersion({
      versionId: thirdArtVersion.id,
      title: '默认造型 · 多参考分支',
      branchLabel: '多参考分支',
      description: '从 2 张有序参考图的不可变快照创建'
    })
    expect(fork.fork.sourceKind).toBe('art_version')
    expect(fork.fork.sourceVersionId).toBe(thirdArtVersion.id)
    expect(fork.fork.sourceHash).toBe(thirdArtVersion.contentHash)
    expect(fork.fork.parentProjectId).toBe(projectId)
    expect(fork.childProject.characterId).toBe(characterId)
    expect(fork.seedArtVersion).not.toBeNull()
    expect(fork.seedArtVersion!.id).toBe(fork.childProject.activeVersionId!)
    expect(fork.seedArtVersion!.versionNumber).toBe(1)
    expect(fork.seedArtVersion!.parentVersionId).toBeNull()
    expect(
      fork.seedArtVersion!.references.map((reference) => [
        reference.assetId,
        reference.role,
        reference.sortOrder,
        reference.isPrimary,
        reference.locked
      ])
    ).toEqual(
      thirdArtVersion.references.map((reference) => [
        reference.assetId,
        reference.role,
        reference.sortOrder,
        reference.isPrimary,
        reference.locked
      ])
    )
    const copiedPrimary = fork.seedArtVersion!.references.filter((reference) => reference.isPrimary)
    expect(copiedPrimary).toHaveLength(1)
    expect(copiedPrimary[0]).toMatchObject({ assetId: manualAsset.id, sortOrder: 0 })
    expect(fork.childProject.id).not.toBe(projectId)
    checks.artVersionForked = true
    checks.forkCopiedOrderedReferences = true

    const rolledBack = await api.activateArtVersion({
      projectId: projectId!,
      versionId: firstArtVersion.id,
      reason: 'rollback',
      expectedProjectRowVersion: revised.project.rowVersion
    })
    expect(rolledBack.project.activeVersionId).toBe(firstArtVersion.id)
    expect(rolledBack.artVersion.id).toBe(firstArtVersion.id)
    const versionsAfterRollback = await api.getArtVersions(projectId!)
    expect(versionsAfterRollback.activeVersionId).toBe(firstArtVersion.id)
    expect(versionsAfterRollback.items.map((item) => item.versionNumber)).toEqual([3, 2, 1])
    checks.rollbackActivated = true

    const backupCreated = await api.createBackup(characterId)
    expect(backupCreated.formatVersion).toBe(1)
    expect(backupCreated.jobId).toMatch(/^job_/)
    const backupJob = await api.waitForJob(backupCreated.jobId)
    expect(backupJob.type).toBe('backup.character')
    expect(backupJob.status).toBe('succeeded')
    const backup = await api.waitForBackup(backupCreated.id)
    expect(backup.status).toBe('succeeded')
    expect(backup.fileSize).toBeGreaterThan(0)
    expect(backup.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(backup.downloadPath).toBe(`/api/v1/backups/${backup.id}/download`)
    checks.backupCompleted = true

    const download = await api.downloadBackup(backup.id)
    expect(download.contentType?.toLowerCase()).toContain('application/zip')
    expect(download.contentDisposition).toBe(
      `attachment; filename="agent2live-${characterId}-${backup.id}.zip"`
    )
    expect(download.contentLength).toBe(String(download.bytes.length))
    expect(download.bytes.length).toBe(backup.fileSize)
    const backupSha256 = sha256Bytes(download.bytes)
    expect(backupSha256).toBe(backup.sha256)
    const zipAbsolutePath = writeEvidenceBytes('backup/character-export.zip', download.bytes)
    const zipRelativePath = evidenceRelativePath(zipAbsolutePath)
    writeEvidenceJson('backup/download.json', {
      schemaVersion: 'backup-download/1',
      backupId: backup.id,
      characterId,
      contentType: download.contentType,
      contentDisposition: download.contentDisposition,
      contentLength: download.contentLength,
      byteSize: download.bytes.length,
      sha256: backupSha256
    })
    checks.backupDownloadVerified = true

    await page.reload()
    await page.locator('[data-testid="studio-ready"]').waitFor({ state: 'visible', timeout: 30_000 })
    await expect(page.locator('[data-testid="studio-global-status"]')).toContainText('实时已连接', {
      timeout: 20_000
    })
    await page.getByRole('link', { name: /返回角色驾驶舱/ }).click()
    await expect(page.getByRole('heading', { name: '凛', level: 1 })).toBeVisible()

    const projectCards = page.locator('[data-testid="project-card"]')
    await expect(projectCards).toHaveCount(2)
    const parentCard = page.locator(`[data-testid="project-card"][data-project-id="${projectId}"]`)
    const childCard = page.locator(`[data-testid="project-card"][data-project-id="${fork.childProject.id}"]`)
    await expect(parentCard).toBeVisible()
    await expect(childCard).toBeVisible()
    await expect(parentCard.locator('[data-testid="art-progress"]')).toHaveAttribute('data-percent', '100')
    await expect(childCard.locator('[data-testid="art-progress"]')).toHaveAttribute('data-percent', '100')
    await expect(childCard.getByText('分支：多参考分支')).toBeVisible()
    await expect(page.locator('[data-testid="backup-panel"]')).toBeVisible()
    const backupRow = page.locator(`[data-testid="backup-row"][data-backup-id="${backup.id}"]`)
    await expect(backupRow).toBeVisible()
    await expect(backupRow.locator('[data-testid="download-backup"]')).toBeVisible()
    checks.cockpitVerified = true

    await parentCard.getByRole('link', { name: '打开工作台', exact: true }).click()
    await expect(page.locator('[data-testid="art-workbench"]')).toBeVisible()
    await expect(page.locator('[data-testid="workbench"]')).toBeVisible({ timeout: 20_000 })
    await expect(page.locator('[data-testid="art-version-panel"]')).toHaveAttribute(
      'data-active-version-id',
      firstArtVersion.id
    )

    await page.getByRole('link', { name: /返回角色驾驶舱/ }).click()
    await expect(page.getByRole('heading', { name: '凛', level: 1 })).toBeVisible()
    await page
      .locator(`[data-testid="project-card"][data-project-id="${fork.childProject.id}"]`)
      .getByRole('link', { name: '打开工作台', exact: true })
      .click()
    await expect(page.locator('[data-testid="workbench"]')).toBeVisible({ timeout: 20_000 })
    await expect(page.locator('[data-testid="art-version-panel"]')).toHaveAttribute(
      'data-active-version-id',
      fork.seedArtVersion!.id
    )
    const originBar = page.locator('[data-testid="fork-origin-bar"]')
    await expect(originBar).toBeVisible()
    await expect(originBar.locator(`code[title="${projectId}"]`)).toBeVisible()
    await expect(originBar).toContainText('美术版本')
    await expect(originBar).toContainText('多参考分支')
    checks.workbenchVerified = true

    expect(Object.values(checks).every(Boolean)).toBe(true)
    writeEvidenceJson('golden-chain.json', {
      schemaVersion: 'golden-chain/1',
      status: 'pass',
      generatedAt: new Date().toISOString(),
      providerMode: 'mock',
      realProvidersVerified: false,
      characterId,
      characterBriefVersionId,
      projectId,
      childProjectId: fork.childProject.id,
      assetId,
      manualAssetId: manualAsset.id,
      promptVersionId: committed.version.id,
      providerConnectionId: provider.id,
      generationId: generation.id,
      generationJobId: generation.jobId,
      candidateId: candidate!.id,
      firstArtVersionId: firstArtVersion.id,
      secondArtVersionId: secondArtVersion.id,
      thirdArtVersionId: thirdArtVersion.id,
      auxiliaryAssetId: auxAsset.id,
      referenceRevisionReason: 'add',
      referenceCount: thirdArtVersion.references.length,
      activeAfterRollback: firstArtVersion.id,
      forkId: fork.fork.id,
      forkSourceHash: fork.fork.sourceHash,
      seedArtVersionId: fork.seedArtVersion!.id,
      seedReferenceCount: fork.seedArtVersion!.references.length,
      backupId: backup.id,
      backupJobId: backupCreated.jobId,
      backupArtifactPath: zipRelativePath,
      backupSha256,
      backupFileSize: download.bytes.length,
      checks
    })
  } finally {
    await studio.close()
  }
})
