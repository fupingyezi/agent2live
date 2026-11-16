import { describe, expect, it } from 'vitest'
import { createTestApp } from './helpers/app'
import { multipartPayload, seedProject, specWithAsset } from './helpers/seed-prompt'
import { png } from './helpers/files'

type Ctx = Awaited<ReturnType<typeof createTestApp>>

async function committedPrompt(ctx: Ctx) {
  const { project, asset } = await seedProject(ctx)
  const form = new FormData()
  form.append(
    'metadata',
    JSON.stringify({
      globalNotes: '清透',
      requirements: [
        { id: 'req_identity', text: '银白长发与蓝色眼睛', strength: 'must' },
        { id: 'req_style', text: '清爽赛璐璐', strength: 'prefer' },
        { id: 'req_avoid', text: '避免写实皮肤', strength: 'avoid' }
      ],
      materials: [
        {
          partName: 'face',
          fileField: 'file_face',
          role: 'identity_reference',
          note: '脸型',
          weight: 1,
          locked: true,
          sortOrder: 0
        }
      ]
    })
  )
  const faceSource = await png(320, 480)
  const faceBytes = new Uint8Array(faceSource.length)
  faceBytes.set(faceSource)
  form.append('file_face', new Blob([faceBytes], { type: 'image/png' }), 'face.png')
  const packed = await multipartPayload(form)
  const inputRes = await ctx.app.inject({
    method: 'POST',
    url: `/api/v1/art-projects/${project.id}/prompt-inputs`,
    headers: { ...ctx.auth, 'content-type': packed.contentType },
    payload: packed.payload
  })
  expect(inputRes.statusCode).toBe(201)
  const input = inputRes.json<{
    submission: { id: string; materials: Array<{ assetId: string }> }
    draft: { id: string; rowVersion: number }
  }>()
  const saved = await ctx.app.inject({
    method: 'PATCH',
    url: `/api/v1/art-projects/${project.id}/prompt-drafts/${input.draft.id}`,
    headers: { ...ctx.auth, 'if-match': `"${input.draft.rowVersion}"` },
    payload: { state: specWithAsset(input.submission.materials[0]!.assetId) }
  })
  expect(saved.statusCode).toBe(200)
  const draft = saved.json<{ rowVersion: number }>()
  const commit = await ctx.app.inject({
    method: 'POST',
    url: `/api/v1/art-projects/${project.id}/prompt-drafts/${input.draft.id}/commit`,
    headers: { ...ctx.auth, 'if-match': `"${draft.rowVersion}"`, 'idempotency-key': 'av-commit-0001' },
    payload: {}
  })
  expect(commit.statusCode).toBe(201)
  return {
    project,
    asset,
    version: commit.json<{ version: { id: string } }>().version
  }
}

let providerCreateSeq = 0
function nextProviderKey(prefix: string): string {
  providerCreateSeq += 1
  return `${prefix}-${String(providerCreateSeq).padStart(4, '0')}`
}

async function mockImageConnection(ctx: Ctx) {
  const response = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/providers',
    headers: { ...ctx.auth, 'idempotency-key': nextProviderKey('provider-mock-image') },
    payload: {
      label: 'Mock image',
      kind: 'image',
      adapter: 'mock',
      capabilities: {
        schemaVersion: 'provider-capabilities/1',
        image: {
          maxReferenceImages: 4,
          maxPromptChars: 20_000,
          supportsNegativePrompt: true,
          supportsWeightSyntax: true,
          supportsSeed: true,
          maxCount: 4,
          sizes: ['512x896', '1024x1792']
        }
      }
    }
  })
  expect(response.statusCode).toBe(201)
  return response.json<{ id: string }>()
}

async function createReadyCandidates(
  ctx: Ctx,
  input: {
    projectId: string
    promptVersionId: string
    providerConnectionId: string
    idempotencyKey: string
    count: number
  }
) {
  const created = await ctx.app.inject({
    method: 'POST',
    url: `/api/v1/art-projects/${input.projectId}/generations`,
    headers: { ...ctx.auth, 'idempotency-key': input.idempotencyKey },
    payload: {
      promptVersionId: input.promptVersionId,
      providerConnectionId: input.providerConnectionId,
      count: input.count,
      size: '512x896',
      seed: 11
    }
  })
  expect(created.statusCode).toBe(202)
  const { generationId, jobId } = created.json<{ generationId: string; jobId: string }>()
  await ctx.services.jobs.tick()
  const fetched = await ctx.app.inject({
    method: 'GET',
    url: `/api/v1/generations/${generationId}`,
    headers: ctx.auth
  })
  expect(fetched.statusCode).toBe(200)
  const generation = fetched.json<{
    status: string
    candidates: Array<{ id: string; assetId: string; status: string }>
  }>()
  expect(generation.status).toBe('succeeded')
  return { generationId, jobId, candidates: generation.candidates }
}

async function currentProject(ctx: Ctx, projectId: string) {
  const response = await ctx.app.inject({
    method: 'GET',
    url: `/api/v1/art-projects/${projectId}`,
    headers: ctx.auth
  })
  expect(response.statusCode).toBe(200)
  return response.json<{
    id: string
    rowVersion: number
    stage: string
    activeVersionId: string | null
    activePromptVersionId: string | null
  }>()
}

describe('art versions', () => {
  it('accepts candidates in order with active-version CAS and immutable lineage', async () => {
    const ctx = await createTestApp()
    try {
      const { project, version } = await committedPrompt(ctx)
      const connection = await mockImageConnection(ctx)
      const ready = await createReadyCandidates(ctx, {
        projectId: project.id,
        promptVersionId: version.id,
        providerConnectionId: connection.id,
        idempotencyKey: 'av-gen-0001',
        count: 2
      })
      expect(ready.candidates).toHaveLength(2)
      const [first, second] = ready.candidates

      const conflicted = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/generation-candidates/${first!.id}/accept`,
        headers: { ...ctx.auth, 'idempotency-key': 'av-accept-conflict' },
        payload: { expectedActiveArtVersionId: 'av_01J00000000000000000000000' }
      })
      expect(conflicted.statusCode).toBe(409)
      expect(conflicted.json()).toMatchObject({
        error: {
          code: 'ART_ACTIVE_VERSION_CHANGED',
          details: { expected: 'av_01J00000000000000000000000', actual: null }
        }
      })

      const accepted = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/generation-candidates/${first!.id}/accept`,
        headers: { ...ctx.auth, 'idempotency-key': 'av-accept-0001' },
        payload: { expectedActiveArtVersionId: null }
      })
      expect(accepted.statusCode).toBe(201)
      const firstBody = accepted.json<{
        artVersion: {
          id: string
          versionNumber: number
          parentVersionId: string | null
          originVersionId: string | null
          promptVersionId: string
          references: Array<{ assetId: string; role: string; sortOrder: number; isPrimary: boolean }>
          contentHash: string
          source: { kind: string; candidateId: string }
        }
        project: { activeVersionId: string; stage: string; rowVersion: number }
      }>()
      expect(firstBody.artVersion).toMatchObject({
        versionNumber: 1,
        parentVersionId: null,
        promptVersionId: version.id,
        references: [
          {
            assetId: first!.assetId,
            role: 'identity_reference',
            sortOrder: 0,
            isPrimary: true
          }
        ],
        source: { kind: 'generation_candidate', candidateId: first!.id }
      })
      expect(firstBody.artVersion.originVersionId).toBe(firstBody.artVersion.id)
      expect(firstBody.artVersion.contentHash).toHaveLength(64)
      expect(firstBody.project).toMatchObject({
        activeVersionId: firstBody.artVersion.id,
        stage: 'art_version_active'
      })

      const replay = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/generation-candidates/${first!.id}/accept`,
        headers: { ...ctx.auth, 'idempotency-key': 'av-accept-0001' },
        payload: { expectedActiveArtVersionId: null }
      })
      expect(replay.statusCode).toBe(201)
      expect(replay.json()).toEqual(firstBody)

      const repeated = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/generation-candidates/${first!.id}/accept`,
        headers: { ...ctx.auth, 'idempotency-key': 'av-accept-repeat' },
        payload: { expectedActiveArtVersionId: firstBody.artVersion.id }
      })
      expect(repeated.statusCode).toBe(409)
      expect(repeated.json()).toMatchObject({
        error: {
          code: 'ART_CANDIDATE_NOT_ACCEPTABLE',
          details: { candidateId: first!.id, status: 'accepted' }
        }
      })

      const secondAccepted = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/generation-candidates/${second!.id}/accept`,
        headers: { ...ctx.auth, 'idempotency-key': 'av-accept-0002' },
        payload: { expectedActiveArtVersionId: firstBody.artVersion.id }
      })
      expect(secondAccepted.statusCode).toBe(201)
      const secondBody = secondAccepted.json<{
        artVersion: {
          id: string
          versionNumber: number
          parentVersionId: string
          originVersionId: string
          references: Array<{ assetId: string; isPrimary: boolean }>
        }
        project: { activeVersionId: string }
      }>()
      expect(secondBody.artVersion).toMatchObject({
        versionNumber: 2,
        parentVersionId: firstBody.artVersion.id,
        originVersionId: firstBody.artVersion.id,
        references: [expect.objectContaining({ assetId: second!.assetId, isPrimary: true })]
      })
      expect(secondBody.project.activeVersionId).toBe(secondBody.artVersion.id)

      const versions = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/art-projects/${project.id}/art-versions`,
        headers: ctx.auth
      })
      expect(versions.statusCode).toBe(200)
      expect(versions.json<{ items: Array<{ id: string }> }>().items.map((item) => item.id)).toEqual([
        secondBody.artVersion.id,
        firstBody.artVersion.id
      ])

      const candidates = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/generations/${ready.generationId}`,
        headers: ctx.auth
      })
      expect(
        candidates.json<{ candidates: Array<{ status: string; acceptedArtVersionId: string }> }>().candidates
      ).toEqual([
        expect.objectContaining({ status: 'accepted', acceptedArtVersionId: firstBody.artVersion.id }),
        expect.objectContaining({ status: 'accepted', acceptedArtVersionId: secondBody.artVersion.id })
      ])
    } finally {
      await ctx.close()
    }
  })

  it('creates manual art versions and switches active with project CAS', async () => {
    const ctx = await createTestApp()
    try {
      const { project, version } = await committedPrompt(ctx)
      const firstAsset = (
        await ctx.services.assets.ingestUpload({
          bytes: await png(480, 720),
          declaredMime: 'image/png',
          originalName: 'manual-1.png',
          requestId: 'av-seed-1',
          traceId: 'av-seed-1'
        })
      ).asset
      const projectBefore = await currentProject(ctx, project.id)

      const first = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/art-projects/${project.id}/art-versions/manual`,
        headers: {
          ...ctx.auth,
          'if-match': `"${projectBefore.rowVersion}"`,
          'idempotency-key': 'av-manual-0001'
        },
        payload: { assetId: firstAsset.id }
      })
      expect(first.statusCode).toBe(201)
      const firstBody = first.json<{
        artVersion: {
          id: string
          versionNumber: number
          references: Array<{ assetId: string; role: string; sortOrder: number; isPrimary: boolean }>
          promptVersionId: string
          source: { kind: string }
        }
        project: { activeVersionId: string; activePromptVersionId: string | null; rowVersion: number }
      }>()
      expect(firstBody.artVersion).toMatchObject({
        versionNumber: 1,
        references: [
          {
            assetId: firstAsset.id,
            role: 'identity_reference',
            sortOrder: 0,
            isPrimary: true
          }
        ],
        promptVersionId: version.id,
        source: { kind: 'manual_upload' }
      })
      expect(firstBody.project).toMatchObject({
        activeVersionId: firstBody.artVersion.id,
        activePromptVersionId: version.id
      })

      const secondAsset = (
        await ctx.services.assets.ingestUpload({
          bytes: await png(480, 720),
          declaredMime: 'image/png',
          originalName: 'manual-2.png',
          requestId: 'av-seed-2',
          traceId: 'av-seed-2'
        })
      ).asset
      const second = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/art-projects/${project.id}/art-versions/manual`,
        headers: {
          ...ctx.auth,
          'if-match': `"${firstBody.project.rowVersion}"`,
          'idempotency-key': 'av-manual-0002'
        },
        payload: { assetId: secondAsset.id, promptVersionId: version.id }
      })
      expect(second.statusCode).toBe(201)
      const secondBody = second.json<{
        artVersion: { id: string; versionNumber: number; parentVersionId: string }
        project: { rowVersion: number; activeVersionId: string }
      }>()
      expect(secondBody.artVersion).toMatchObject({
        versionNumber: 2,
        parentVersionId: firstBody.artVersion.id
      })

      const stale = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/art-projects/${project.id}/art-versions/manual`,
        headers: {
          ...ctx.auth,
          'if-match': `"${firstBody.project.rowVersion}"`,
          'idempotency-key': 'av-manual-stale'
        },
        payload: { assetId: firstAsset.id }
      })
      expect(stale.statusCode).toBe(409)
      expect(stale.json()).toMatchObject({ error: { code: 'ROW_VERSION_CONFLICT' } })

      const activated = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/art-projects/${project.id}/art-versions/${firstBody.artVersion.id}/activate`,
        headers: {
          ...ctx.auth,
          'if-match': `"${secondBody.project.rowVersion}"`,
          'idempotency-key': 'av-activate-0001'
        },
        payload: { reason: 'rollback' }
      })
      expect(activated.statusCode).toBe(200)
      const activatedBody = activated.json<{
        artVersion: { id: string }
        project: { activeVersionId: string; stage: string; rowVersion: number }
      }>()
      expect(activatedBody.artVersion.id).toBe(firstBody.artVersion.id)
      expect(activatedBody.project).toMatchObject({
        activeVersionId: firstBody.artVersion.id,
        stage: 'art_version_active',
        rowVersion: secondBody.project.rowVersion + 1
      })

      const versionResponse = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/art-projects/${project.id}/art-versions/${firstBody.artVersion.id}`,
        headers: ctx.auth
      })
      expect(versionResponse.statusCode).toBe(200)
      expect(versionResponse.json()).toMatchObject({
        id: firstBody.artVersion.id,
        references: [expect.objectContaining({ assetId: firstAsset.id, isPrimary: true })]
      })
    } finally {
      await ctx.close()
    }
  })

  it('restores a historical version as a new active immutable snapshot', async () => {
    const ctx = await createTestApp()
    try {
      const { project, version } = await committedPrompt(ctx)
      const primaryAsset = (
        await ctx.services.assets.ingestUpload({
          bytes: await png(480, 720),
          declaredMime: 'image/png',
          originalName: 'restore-primary.png',
          requestId: 'av-restore-seed-1',
          traceId: 'av-restore-seed-1'
        })
      ).asset
      const auxiliaryAsset = (
        await ctx.services.assets.ingestUpload({
          bytes: await png(320, 480),
          declaredMime: 'image/png',
          originalName: 'restore-auxiliary.png',
          requestId: 'av-restore-seed-2',
          traceId: 'av-restore-seed-2'
        })
      ).asset
      const currentAsset = (
        await ctx.services.assets.ingestUpload({
          bytes: await png(480, 720),
          declaredMime: 'image/png',
          originalName: 'restore-current.png',
          requestId: 'av-restore-seed-3',
          traceId: 'av-restore-seed-3'
        })
      ).asset

      const projectBefore = await currentProject(ctx, project.id)
      const first = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/art-projects/${project.id}/art-versions/manual`,
        headers: {
          ...ctx.auth,
          'if-match': `"${projectBefore.rowVersion}"`,
          'idempotency-key': 'av-restore-v1'
        },
        payload: { assetId: primaryAsset.id }
      })
      expect(first.statusCode).toBe(201)
      const firstBody = first.json<{
        artVersion: { id: string }
        project: { rowVersion: number }
      }>()

      const revised = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/art-versions/${firstBody.artVersion.id}/reference-revisions`,
        headers: {
          ...ctx.auth,
          'if-match': `"${firstBody.project.rowVersion}"`,
          'idempotency-key': 'av-restore-v2'
        },
        payload: {
          reason: 'add',
          references: [
            {
              assetId: primaryAsset.id,
              role: 'identity_reference',
              note: '主图',
              weight: 1,
              sortOrder: 0,
              isPrimary: true,
              locked: true
            },
            {
              assetId: auxiliaryAsset.id,
              role: 'style_reference',
              note: '只继承画风',
              weight: 1.4,
              sortOrder: 1,
              isPrimary: false,
              locked: false
            }
          ]
        }
      })
      expect(revised.statusCode).toBe(201)
      const historical = revised.json<{
        artVersion: {
          id: string
          versionNumber: number
          promptVersionId: string
          references: Array<{
            assetId: string
            role: string
            note: string
            weight: number
            sortOrder: number
            isPrimary: boolean
            locked: boolean
          }>
          source: Record<string, unknown>
          validation: Record<string, unknown>
          canvasTransform: Record<string, unknown>
        }
        project: { rowVersion: number }
      }>().artVersion

      const current = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/art-projects/${project.id}/art-versions/manual`,
        headers: {
          ...ctx.auth,
          'if-match': `"${revised.json<{ project: { rowVersion: number } }>().project.rowVersion}"`,
          'idempotency-key': 'av-restore-current'
        },
        payload: { assetId: currentAsset.id, promptVersionId: version.id }
      })
      expect(current.statusCode).toBe(201)
      const currentBody = current.json<{
        artVersion: { id: string; versionNumber: number }
        project: { rowVersion: number }
      }>()

      const restore = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/art-projects/${project.id}/art-versions/${historical.id}/restore`,
        headers: {
          ...ctx.auth,
          'if-match': `"${currentBody.project.rowVersion}"`,
          'idempotency-key': 'av-restore-0001'
        },
        payload: {}
      })
      expect(restore.statusCode).toBe(201)
      const restoredBody = restore.json<{
        artVersion: {
          id: string
          versionNumber: number
          parentVersionId: string | null
          originVersionId: string | null
          promptVersionId: string
          references: typeof historical.references
          source: Record<string, unknown>
          validation: Record<string, unknown>
          canvasTransform: Record<string, unknown>
        }
        project: { activeVersionId: string; rowVersion: number }
      }>()
      expect(restoredBody.artVersion.id).not.toBe(historical.id)
      expect(restoredBody.artVersion).toMatchObject({
        versionNumber: currentBody.artVersion.versionNumber + 1,
        parentVersionId: historical.id,
        originVersionId: historical.id,
        promptVersionId: historical.promptVersionId,
        references: historical.references.map((reference) => ({ ...reference })),
        source: historical.source,
        validation: historical.validation,
        canvasTransform: historical.canvasTransform
      })
      expect(restoredBody.project.activeVersionId).toBe(restoredBody.artVersion.id)

      const replay = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/art-projects/${project.id}/art-versions/${historical.id}/restore`,
        headers: {
          ...ctx.auth,
          'if-match': `"${currentBody.project.rowVersion}"`,
          'idempotency-key': 'av-restore-0001'
        },
        payload: {}
      })
      expect(replay.statusCode).toBe(201)
      expect(replay.json()).toEqual(restoredBody)

      const stale = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/art-projects/${project.id}/art-versions/${historical.id}/restore`,
        headers: {
          ...ctx.auth,
          'if-match': `"${currentBody.project.rowVersion}"`,
          'idempotency-key': 'av-restore-stale'
        },
        payload: {}
      })
      expect(stale.statusCode).toBe(409)
      expect(stale.json()).toMatchObject({ error: { code: 'ROW_VERSION_CONFLICT' } })

      const versions = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/art-projects/${project.id}/art-versions`,
        headers: ctx.auth
      })
      expect(versions.json<{ items: Array<{ id: string }> }>().items.map((item) => item.id)).toEqual([
        restoredBody.artVersion.id,
        currentBody.artVersion.id,
        historical.id,
        firstBody.artVersion.id
      ])
    } finally {
      await ctx.close()
    }
  })

  it('revises reference sets into immutable snapshots and copies auxiliaries on candidate acceptance', async () => {
    const ctx = await createTestApp()
    try {
      const { project, version } = await committedPrompt(ctx)
      const primaryAsset = (
        await ctx.services.assets.ingestUpload({
          bytes: await png(480, 720),
          declaredMime: 'image/png',
          originalName: 'ref-primary.png',
          requestId: 'av-ref-seed-1',
          traceId: 'av-ref-seed-1'
        })
      ).asset
      const auxAsset = (
        await ctx.services.assets.ingestUpload({
          bytes: await png(320, 480),
          declaredMime: 'image/png',
          originalName: 'ref-aux.png',
          requestId: 'av-ref-seed-2',
          traceId: 'av-ref-seed-2'
        })
      ).asset
      const textureAsset = (
        await ctx.services.assets.ingestUpload({
          bytes: await png(256, 256),
          declaredMime: 'image/png',
          originalName: 'ref-texture.png',
          requestId: 'av-ref-seed-3',
          traceId: 'av-ref-seed-3'
        })
      ).asset

      const projectBefore = await currentProject(ctx, project.id)
      const first = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/art-projects/${project.id}/art-versions/manual`,
        headers: {
          ...ctx.auth,
          'if-match': `"${projectBefore.rowVersion}"`,
          'idempotency-key': 'av-ref-v1'
        },
        payload: { assetId: primaryAsset.id }
      })
      expect(first.statusCode).toBe(201)
      const firstBody = first.json<{
        artVersion: { id: string; versionNumber: number }
        project: { rowVersion: number }
      }>()

      const added = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/art-versions/${firstBody.artVersion.id}/reference-revisions`,
        headers: {
          ...ctx.auth,
          'if-match': `"${firstBody.project.rowVersion}"`,
          'idempotency-key': 'av-ref-add-0001'
        },
        payload: {
          reason: 'add',
          references: [
            {
              assetId: primaryAsset.id,
              role: 'identity_reference',
              note: '',
              weight: 1,
              sortOrder: 0,
              isPrimary: true,
              locked: false
            },
            {
              assetId: auxAsset.id,
              role: 'style_reference',
              note: '光影',
              weight: 1.5,
              sortOrder: 1,
              isPrimary: false,
              locked: true
            },
            {
              assetId: textureAsset.id,
              role: 'texture',
              note: '',
              weight: 0.8,
              sortOrder: 2,
              isPrimary: false,
              locked: false
            }
          ]
        }
      })
      expect(added.statusCode).toBe(201)
      const addedBody = added.json<{
        artVersion: {
          id: string
          versionNumber: number
          parentVersionId: string
          originVersionId: string
          references: Array<{
            assetId: string
            role: string
            note: string
            weight: number
            sortOrder: number
            isPrimary: boolean
            locked: boolean
          }>
        }
        project: { activeVersionId: string; rowVersion: number }
      }>()
      expect(addedBody.artVersion).toMatchObject({
        versionNumber: 2,
        parentVersionId: firstBody.artVersion.id,
        originVersionId: firstBody.artVersion.id
      })
      expect(
        addedBody.artVersion.references.map((reference) => [
          reference.assetId,
          reference.role,
          reference.sortOrder,
          reference.isPrimary,
          reference.weight,
          reference.locked
        ])
      ).toEqual([
        [primaryAsset.id, 'identity_reference', 0, true, 1, false],
        [auxAsset.id, 'style_reference', 1, false, 1.5, true],
        [textureAsset.id, 'texture', 2, false, 0.8, false]
      ])
      expect(addedBody.project.activeVersionId).toBe(addedBody.artVersion.id)
      expect(addedBody.project.rowVersion).toBe(firstBody.project.rowVersion + 1)

      const original = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/art-versions/${firstBody.artVersion.id}/references`,
        headers: ctx.auth
      })
      expect(original.statusCode).toBe(200)
      expect(original.json()).toMatchObject({
        artVersionId: firstBody.artVersion.id,
        references: [{ assetId: primaryAsset.id, isPrimary: true }]
      })

      const switched = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/art-versions/${addedBody.artVersion.id}/reference-revisions`,
        headers: {
          ...ctx.auth,
          'if-match': `"${addedBody.project.rowVersion}"`,
          'idempotency-key': 'av-ref-switch-0001'
        },
        payload: {
          reason: 'switch_primary',
          references: [
            {
              assetId: auxAsset.id,
              role: 'identity_reference',
              note: '',
              weight: 1,
              sortOrder: 0,
              isPrimary: true,
              locked: false
            },
            {
              assetId: primaryAsset.id,
              role: 'style_reference',
              note: '',
              weight: 1,
              sortOrder: 1,
              isPrimary: false,
              locked: false
            },
            {
              assetId: textureAsset.id,
              role: 'texture',
              note: '',
              weight: 0.8,
              sortOrder: 2,
              isPrimary: false,
              locked: false
            }
          ]
        }
      })
      expect(switched.statusCode).toBe(201)
      const switchedBody = switched.json<{
        artVersion: {
          id: string
          versionNumber: number
          parentVersionId: string
          references: Array<{ assetId: string; sortOrder: number; isPrimary: boolean }>
        }
        project: { activeVersionId: string; rowVersion: number }
      }>()
      expect(switchedBody.artVersion).toMatchObject({
        versionNumber: 3,
        parentVersionId: addedBody.artVersion.id
      })
      expect(
        switchedBody.artVersion.references.map((reference) => [
          reference.assetId,
          reference.sortOrder,
          reference.isPrimary
        ])
      ).toEqual([
        [auxAsset.id, 0, true],
        [primaryAsset.id, 1, false],
        [textureAsset.id, 2, false]
      ])
      expect(switchedBody.project.activeVersionId).toBe(switchedBody.artVersion.id)

      const branch = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/art-versions/${firstBody.artVersion.id}/reference-revisions`,
        headers: {
          ...ctx.auth,
          'if-match': `"${switchedBody.project.rowVersion}"`,
          'idempotency-key': 'av-ref-branch-0001'
        },
        payload: {
          reason: 'add',
          references: [
            {
              assetId: primaryAsset.id,
              role: 'identity_reference',
              note: '',
              weight: 1,
              sortOrder: 0,
              isPrimary: true,
              locked: false
            },
            {
              assetId: textureAsset.id,
              role: 'texture',
              note: '',
              weight: 0.8,
              sortOrder: 1,
              isPrimary: false,
              locked: false
            }
          ]
        }
      })
      expect(branch.statusCode).toBe(201)
      const branchBody = branch.json<{
        artVersion: { id: string; versionNumber: number; parentVersionId: string }
        project: { activeVersionId: string; rowVersion: number }
      }>()
      expect(branchBody.artVersion).toMatchObject({
        versionNumber: 4,
        parentVersionId: firstBody.artVersion.id
      })
      expect(branchBody.project.activeVersionId).toBe(switchedBody.artVersion.id)
      expect(branchBody.project.rowVersion).toBe(switchedBody.project.rowVersion + 1)

      const stale = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/art-versions/${firstBody.artVersion.id}/reference-revisions`,
        headers: {
          ...ctx.auth,
          'if-match': `"${firstBody.project.rowVersion}"`,
          'idempotency-key': 'av-ref-stale'
        },
        payload: {
          reason: 'metadata',
          references: [
            {
              assetId: primaryAsset.id,
              role: 'identity_reference',
              note: '',
              weight: 1,
              sortOrder: 0,
              isPrimary: true,
              locked: false
            }
          ]
        }
      })
      expect(stale.statusCode).toBe(409)
      expect(stale.json()).toMatchObject({ error: { code: 'ROW_VERSION_CONFLICT' } })

      const invalid = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/art-versions/${firstBody.artVersion.id}/reference-revisions`,
        headers: {
          ...ctx.auth,
          'if-match': `"${branchBody.project.rowVersion}"`,
          'idempotency-key': 'av-ref-invalid'
        },
        payload: {
          reason: 'switch_primary',
          references: [
            {
              assetId: auxAsset.id,
              role: 'identity_reference',
              note: '',
              weight: 1,
              sortOrder: 0,
              isPrimary: true,
              locked: false
            },
            {
              assetId: primaryAsset.id,
              role: 'style_reference',
              note: '',
              weight: 1,
              sortOrder: 1,
              isPrimary: true,
              locked: false
            }
          ]
        }
      })
      expect(invalid.statusCode).toBe(422)
      expect(invalid.json()).toMatchObject({
        error: { code: 'ART_REFERENCE_PRIMARY_REQUIRED' }
      })

      const connection = await mockImageConnection(ctx)
      const ready = await createReadyCandidates(ctx, {
        projectId: project.id,
        promptVersionId: version.id,
        providerConnectionId: connection.id,
        idempotencyKey: 'av-ref-gen-0001',
        count: 1
      })
      const candidate = ready.candidates[0]!
      const accepted = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/generation-candidates/${candidate.id}/accept`,
        headers: { ...ctx.auth, 'idempotency-key': 'av-ref-accept-0001' },
        payload: { expectedActiveArtVersionId: switchedBody.artVersion.id }
      })
      expect(accepted.statusCode).toBe(201)
      const acceptedBody = accepted.json<{
        artVersion: {
          id: string
          versionNumber: number
          references: Array<{ assetId: string; sortOrder: number; isPrimary: boolean }>
        }
        project: { activeVersionId: string; rowVersion: number }
      }>()
      expect(acceptedBody.artVersion.versionNumber).toBe(5)
      expect(
        acceptedBody.artVersion.references.map((reference) => [
          reference.assetId,
          reference.sortOrder,
          reference.isPrimary
        ])
      ).toEqual([
        [candidate.assetId, 0, true],
        [primaryAsset.id, 1, false],
        [textureAsset.id, 2, false]
      ])
      expect(acceptedBody.project.activeVersionId).toBe(acceptedBody.artVersion.id)

      const rolledBack = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/art-projects/${project.id}/art-versions/${addedBody.artVersion.id}/activate`,
        headers: {
          ...ctx.auth,
          'if-match': `"${acceptedBody.project.rowVersion}"`,
          'idempotency-key': 'av-ref-rollback-0001'
        },
        payload: { reason: 'rollback' }
      })
      expect(rolledBack.statusCode).toBe(200)
      const rolledBackBody = rolledBack.json<{
        artVersion: { id: string; references: Array<{ assetId: string; isPrimary: boolean }> }
        project: { activeVersionId: string }
      }>()
      expect(
        rolledBackBody.artVersion.references.map((reference) => [reference.assetId, reference.isPrimary])
      ).toEqual([
        [primaryAsset.id, true],
        [auxAsset.id, false],
        [textureAsset.id, false]
      ])
      expect(rolledBackBody.project.activeVersionId).toBe(addedBody.artVersion.id)
    } finally {
      await ctx.close()
    }
  })

  it('requires an active prompt version for manual art uploads', async () => {
    const ctx = await createTestApp()
    try {
      const { project } = await seedProject(ctx)
      const asset = (
        await ctx.services.assets.ingestUpload({
          bytes: await png(320, 480),
          declaredMime: 'image/png',
          originalName: 'plain.png',
          requestId: 'av-seed-3',
          traceId: 'av-seed-3'
        })
      ).asset
      const current = await currentProject(ctx, project.id)
      const response = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/art-projects/${project.id}/art-versions/manual`,
        headers: {
          ...ctx.auth,
          'if-match': `"${current.rowVersion}"`,
          'idempotency-key': 'av-manual-no-prompt'
        },
        payload: { assetId: asset.id }
      })
      expect(response.statusCode).toBe(409)
      expect(response.json()).toMatchObject({
        error: { code: 'PROMPT_VERSION_REQUIRED', details: { artProjectId: project.id } }
      })
    } finally {
      await ctx.close()
    }
  })
})
