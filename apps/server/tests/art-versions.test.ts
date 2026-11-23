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
  it('accepts candidates as final artwork with active-version CAS and immutable lineage', async () => {
    const ctx = await createTestApp()
    try {
      const { project, version } = await committedPrompt(ctx)
      const connection = await mockImageConnection(ctx)
      const { generationId, candidates } = await createReadyCandidates(ctx, {
        projectId: project.id,
        promptVersionId: version.id,
        providerConnectionId: connection.id,
        idempotencyKey: 'av-generation-0001',
        count: 2
      })
      expect(candidates).toHaveLength(2)

      const first = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/generation-candidates/${candidates[0]!.id}/accept`,
        headers: { ...ctx.auth, 'idempotency-key': 'av-accept-0001' },
        payload: { expectedActiveArtVersionId: null }
      })
      expect(first.statusCode).toBe(201)
      const firstBody = first.json<{
        artVersion: {
          id: string
          versionNumber: number
          artworkAssetId: string
          generationId: string
          sourceKind: string
          parentVersionId: string | null
          originVersionId: string | null
          references?: unknown
        }
        artProject: { activeVersionId: string }
      }>()
      expect(firstBody.artVersion).toMatchObject({
        artworkAssetId: candidates[0]!.assetId,
        generationId: generationId,
        sourceKind: 'generated',
        parentVersionId: null,
        originVersionId: firstBody.artVersion.id
      })
      expect(firstBody.artVersion).not.toHaveProperty('references')
      expect(firstBody.artProject.activeVersionId).toBe(firstBody.artVersion.id)
      expect(
        ctx.db.prepare("select count(*) as n from asset_links where owner_type = 'art_version'").get()
      ).toEqual({ n: 0 })

      const second = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/generation-candidates/${candidates[1]!.id}/accept`,
        headers: { ...ctx.auth, 'idempotency-key': 'av-accept-0002' },
        payload: { expectedActiveArtVersionId: firstBody.artVersion.id }
      })
      expect(second.statusCode).toBe(201)
      const secondBody = second.json<{
        artVersion: {
          id: string
          versionNumber: number
          artworkAssetId: string
          parentVersionId: string
          originVersionId: string
          promptVersionId: string
        }
      }>()
      expect(secondBody.artVersion).toMatchObject({
        artworkAssetId: candidates[1]!.assetId,
        parentVersionId: firstBody.artVersion.id,
        originVersionId: firstBody.artVersion.id,
        promptVersionId: version.id
      })
      expect(secondBody.artVersion.versionNumber).toBe(2)

      const projectRow = await currentProject(ctx, project.id)
      const activated = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/art-projects/${project.id}/art-versions/${firstBody.artVersion.id}/activate`,
        headers: {
          ...ctx.auth,
          'if-match': `"${projectRow.rowVersion}"`,
          'idempotency-key': 'av-activate-0001'
        },
        payload: { reason: 'rollback' }
      })
      expect(activated.statusCode).toBe(200)
      expect(activated.json()).toMatchObject({
        artVersion: { id: firstBody.artVersion.id },
        artProject: {
          activeVersionId: firstBody.artVersion.id,
          activePromptVersionId: version.id
        }
      })
      const promptVersion = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/art-projects/${project.id}/prompt-versions/${version.id}`,
        headers: ctx.auth
      })
      expect(promptVersion.statusCode).toBe(200)
      expect(promptVersion.json()).toMatchObject({ id: version.id, references: [expect.any(Object)] })
    } finally {
      await ctx.close()
    }
  })

  it('creates manual art versions without references and switches active with project CAS', async () => {
    const ctx = await createTestApp()
    try {
      const { project, version } = await committedPrompt(ctx)
      const uploaded = (
        await ctx.services.assets.ingestUpload({
          bytes: await png(320, 480),
          declaredMime: 'image/png',
          originalName: 'manual-art.png',
          requestId: 'av-manual-1',
          traceId: 'av-manual-1'
        })
      ).asset
      const current = await currentProject(ctx, project.id)
      const created = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/art-projects/${project.id}/art-versions/manual`,
        headers: {
          ...ctx.auth,
          'if-match': `"${current.rowVersion}"`,
          'idempotency-key': 'av-manual-0001'
        },
        payload: { assetId: uploaded.id }
      })
      expect(created.statusCode).toBe(201)
      const body = created.json<{
        artVersion: {
          id: string
          artworkAssetId: string
          generationId: string | null
          sourceKind: string
          promptVersionId: string
          references?: unknown
        }
        artProject: { activeVersionId: string; edge?: string }
      }>()
      expect(body.artVersion).toMatchObject({
        artworkAssetId: uploaded.id,
        generationId: null,
        sourceKind: 'manual_upload',
        promptVersionId: version.id
      })
      expect(body.artVersion).not.toHaveProperty('references')
      expect(body.artProject.activeVersionId).toBe(body.artVersion.id)

      const stale = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/art-projects/${project.id}/art-versions/${body.artVersion.id}/activate`,
        headers: {
          ...ctx.auth,
          'if-match': `"${current.rowVersion}"`,
          'idempotency-key': 'av-manual-0002'
        },
        payload: { reason: 'switch' }
      })
      expect(stale.statusCode).toBe(409)
    } finally {
      await ctx.close()
    }
  })

  it('rejects removed art reference routes', async () => {
    const ctx = await createTestApp()
    try {
      const { project } = await committedPrompt(ctx)
      const missing = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/art-versions/artv_01J00000000000000000000000/references',
        headers: ctx.auth
      })
      expect(missing.statusCode).toBe(404)
      const revision = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/art-versions/artv_01J00000000000000000000000/reference-revisions',
        headers: { ...ctx.auth, 'idempotency-key': 'av-removed-0001' },
        payload: { references: [], reason: 'metadata' }
      })
      expect(revision.statusCode).toBe(404)
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
