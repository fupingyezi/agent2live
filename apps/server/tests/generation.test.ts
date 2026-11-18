import { describe, expect, it } from 'vitest'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { hashCanonical, newId, SEEDREAM_CAPABILITIES } from '@agent2live/contracts'
import { createTestApp } from './helpers/app'
import { StaticSecretResolver } from '../src/services/secret-resolver'
import { multipartPayload, seedProject, specWithAsset } from './helpers/seed-prompt'
import { png } from './helpers/files'

type Ctx = Awaited<ReturnType<typeof createTestApp>>

async function committedPrompt(ctx: Ctx, options: { materials?: number } = {}) {
  const { project } = await seedProject(ctx)
  const materialCount = options.materials ?? 1
  const materials = Array.from({ length: materialCount }, (_, index) => ({
    partName: index === 0 ? 'face' : `part_${index}`,
    fileField: `file_${index}`,
    role: index === 0 ? 'identity_reference' : 'style_reference',
    note: index === 0 ? '脸型' : `参考${index}`,
    weight: 1,
    locked: index === 0,
    sortOrder: index
  }))
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
      materials
    })
  )
  for (const material of materials) {
    const source = await png(320, 480 + material.sortOrder * 10)
    const bytes = new Uint8Array(source.length)
    bytes.set(source)
    form.append(material.fileField, new Blob([bytes], { type: 'image/png' }), `${material.fileField}.png`)
  }
  const packed = await multipartPayload(form)
  const input = await ctx.app.inject({
    method: 'POST',
    url: `/api/v1/art-projects/${project.id}/prompt-inputs`,
    headers: { ...ctx.auth, 'content-type': packed.contentType },
    payload: packed.payload
  })
  expect(input.statusCode).toBe(201)
  const inputBody = input.json<{
    submission: { id: string; materials: Array<{ assetId: string }> }
    draft: { id: string; rowVersion: number }
  }>()
  const state = specWithAsset(inputBody.submission.materials[0]!.assetId) as {
    materialRefs: Array<Record<string, unknown>>
  }
  state.materialRefs = materials.map((material, index) => ({
    assetId: inputBody.submission.materials[index]!.assetId,
    role: material.role,
    note: material.note,
    weight: material.weight,
    locked: material.locked
  }))
  const saved = await ctx.app.inject({
    method: 'PATCH',
    url: `/api/v1/art-projects/${project.id}/prompt-drafts/${inputBody.draft.id}`,
    headers: { ...ctx.auth, 'if-match': `"${inputBody.draft.rowVersion}"` },
    payload: { state }
  })
  expect(saved.statusCode).toBe(200)
  const draft = saved.json<{ rowVersion: number }>()
  const commit = await ctx.app.inject({
    method: 'POST',
    url: `/api/v1/art-projects/${project.id}/prompt-drafts/${inputBody.draft.id}/commit`,
    headers: { ...ctx.auth, 'if-match': `"${draft.rowVersion}"`, 'idempotency-key': 'gen-commit-0001' },
    payload: {}
  })
  expect(commit.statusCode).toBe(201)
  return {
    project,
    version: commit.json<{ version: { id: string } }>().version,
    materialAssetIds: inputBody.submission.materials.map((material) => material.assetId)
  }
}

let providerCreateSeq = 0
function nextProviderKey(prefix: string): string {
  providerCreateSeq += 1
  return `${prefix}-${String(providerCreateSeq).padStart(4, '0')}`
}

async function mockImageConnection(ctx: Ctx, overrides: Record<string, unknown> = {}) {
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
          sizes: ['512x896', '1024x1792'],
          ...overrides
        }
      }
    }
  })
  expect(response.statusCode).toBe(201)
  return response.json<{ id: string }>()
}

function seedArtVersion(
  ctx: Ctx,
  projectId: string,
  promptVersionId: string,
  artworkAssetId: string
): string {
  const now = ctx.clock.now()
  const versionId = newId('artVersion')
  ctx.db
    .prepare(
      `insert into art_versions
     (id, art_project_id, parent_version_id, origin_version_id, prompt_version_id,
      artwork_asset_id, generation_job_id, source_kind, source_json, validation_json,
      canvas_transform_json, content_hash, version_number, created_at)
     values (?, ?, null, ?, ?, ?, null, 'manual_upload', '{}', '{}', '{}', ?, 1, ?)`
    )
    .run(versionId, projectId, versionId, promptVersionId, artworkAssetId, hashCanonical({ versionId }), now)
  ctx.db
    .prepare(
      `update art_projects
     set active_version_id = ?, stage = 'art_version_active', updated_at = ?, row_version = row_version + 1
     where id = ?`
    )
    .run(versionId, now, projectId)
  return versionId
}

describe('generation jobs', () => {
  it('runs a mock generation and records decodable ready candidates', async () => {
    const ctx = await createTestApp()
    try {
      const { project, version } = await committedPrompt(ctx)
      const connection = await mockImageConnection(ctx)
      const created = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/art-projects/${project.id}/generations`,
        headers: { ...ctx.auth, 'idempotency-key': 'generation-key-0001' },
        payload: {
          promptVersionId: version.id,
          providerConnectionId: connection.id,
          count: 2,
          size: '512x896',
          seed: 7
        }
      })
      expect(created.statusCode).toBe(202)
      const createdBody = created.json<{
        generationId: string
        jobId: string
        referenceAssetIds: string[]
        references: {
          mode: string
          requested: Array<{ source: string }>
          fingerprint: string
        }
      }>()
      expect(createdBody.referenceAssetIds).toHaveLength(1)
      expect(createdBody.references.mode).toBe('full')
      expect(createdBody.references.requested).toHaveLength(1)
      expect(createdBody.references.requested[0]!.source).toBe('prompt_version')
      expect(createdBody.references.fingerprint).toHaveLength(64)
      await ctx.services.jobs.tick()

      const generation = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/generations/${createdBody.generationId}`,
        headers: ctx.auth
      })
      expect(generation.statusCode).toBe(200)
      const body = generation.json<{
        status: string
        baseArtVersionId: string | null
        candidates: Array<{
          status: string
          assetId: string
          validation: { width: number; height: number; sha256: string }
          asset: { id: string; mediaType: string }
        }>
      }>()
      expect(body.status).toBe('succeeded')
      expect(body.baseArtVersionId).toBeNull()
      expect(ctx.db.prepare('select stage from art_projects where id = ?').get(project.id)).toEqual({
        stage: 'candidate_review'
      })
      expect(body.candidates).toHaveLength(2)
      for (const candidate of body.candidates) {
        expect(candidate.status).toBe('ready')
        expect(candidate.asset.id).toBe(candidate.assetId)
        expect(candidate.asset.mediaType).toBe('image/png')
        expect(candidate.validation.width).toBe(512)
        expect(candidate.validation.height).toBe(896)
        expect(candidate.validation.sha256).toHaveLength(64)
      }

      const replay = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/art-projects/${project.id}/generations`,
        headers: { ...ctx.auth, 'idempotency-key': 'generation-key-0001' },
        payload: {
          promptVersionId: version.id,
          providerConnectionId: connection.id,
          count: 2,
          size: '512x896',
          seed: 7
        }
      })
      expect(replay.statusCode).toBe(202)
      expect(replay.json()).toMatchObject({
        generationId: createdBody.generationId,
        jobId: createdBody.jobId
      })

      const reused = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/art-projects/${project.id}/generations`,
        headers: { ...ctx.auth, 'idempotency-key': 'generation-key-0001' },
        payload: {
          promptVersionId: version.id,
          providerConnectionId: connection.id,
          count: 1,
          size: '512x896',
          seed: 7
        }
      })
      expect(reused.statusCode).toBe(409)
      expect(reused.json()).toMatchObject({
        error: {
          code: 'IDEMPOTENCY_KEY_REUSED',
          details: { scope: `generation.create:${project.id}` }
        }
      })
    } finally {
      await ctx.close()
    }
  })

  it('rejects sizes, counts, and seeds outside the connection profile', async () => {
    const ctx = await createTestApp()
    try {
      const { project, version } = await committedPrompt(ctx)
      const noSeed = await mockImageConnection(ctx, { supportsSeed: false })
      const unsupportedSize = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/art-projects/${project.id}/generations`,
        headers: { ...ctx.auth, 'idempotency-key': 'generation-key-0002' },
        payload: {
          promptVersionId: version.id,
          providerConnectionId: noSeed.id,
          count: 1,
          size: '999x999'
        }
      })
      expect(unsupportedSize.statusCode).toBe(400)
      expect(unsupportedSize.json()).toMatchObject({ error: { code: 'REQUEST_INVALID' } })

      const unsupportedCount = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/art-projects/${project.id}/generations`,
        headers: { ...ctx.auth, 'idempotency-key': 'generation-key-0003' },
        payload: {
          promptVersionId: version.id,
          providerConnectionId: noSeed.id,
          count: 9,
          size: '512x896'
        }
      })
      expect(unsupportedCount.statusCode).toBe(400)
      expect(unsupportedCount.json()).toMatchObject({ error: { code: 'REQUEST_INVALID' } })

      const unsupportedSeed = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/art-projects/${project.id}/generations`,
        headers: { ...ctx.auth, 'idempotency-key': 'generation-key-0004' },
        payload: {
          promptVersionId: version.id,
          providerConnectionId: noSeed.id,
          count: 1,
          size: '512x896',
          seed: 1
        }
      })
      expect(unsupportedSeed.statusCode).toBe(422)
      expect(unsupportedSeed.json()).toMatchObject({
        error: { code: 'PROVIDER_CAPABILITY_UNSUPPORTED' }
      })
    } finally {
      await ctx.close()
    }
  })

  it('uses PromptVersion references and records an explicit base ArtVersion', async () => {
    const ctx = await createTestApp()
    try {
      const { project, version, materialAssetIds } = await committedPrompt(ctx, { materials: 3 })
      const baseArtVersionId = seedArtVersion(ctx, project.id, version.id, materialAssetIds[2]!)
      const connection = await mockImageConnection(ctx, { maxReferenceImages: 2 })
      const created = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/art-projects/${project.id}/generations`,
        headers: { ...ctx.auth, 'idempotency-key': 'generation-key-0005' },
        payload: {
          promptVersionId: version.id,
          baseArtVersionId,
          providerConnectionId: connection.id,
          count: 1,
          size: '512x896'
        }
      })
      expect(created.statusCode).toBe(202)
      const body = created.json<{
        generationId: string
        baseArtVersionId: string
        referenceAssetIds: string[]
        references: {
          mode: string
          requested: Array<{ assetId: string; source: string; sortOrder: number }>
          sentAssetIds: string[]
          droppedAssetIds: string[]
          warnings: string[]
          fingerprint: string
        }
      }>()
      expect(body.baseArtVersionId).toBe(baseArtVersionId)
      expect(body.referenceAssetIds).toEqual(materialAssetIds.slice(0, 2))
      expect(body.references.mode).toBe('truncated')
      expect(body.references.requested.map((reference) => reference.assetId)).toEqual(materialAssetIds)
      expect(body.references.requested.every((reference) => reference.source === 'prompt_version')).toBe(true)
      expect(body.references.sentAssetIds).toEqual(materialAssetIds.slice(0, 2))
      expect(body.references.droppedAssetIds).toEqual([materialAssetIds[2]])
      expect(body.references.warnings).toContain('reference_budget_exceeded')
      expect(body.references.fingerprint).toHaveLength(64)

      const generation = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/generations/${body.generationId}`,
        headers: ctx.auth
      })
      const snapshot = generation.json<{
        request: { references: { requested: unknown[]; droppedAssetIds: string[] } }
      }>()
      expect(snapshot.request.references.requested).toHaveLength(3)
      expect(snapshot.request.references.droppedAssetIds).toEqual([materialAssetIds[2]])
    } finally {
      await ctx.close()
    }
  })

  it('sends only the first reference for a single-image provider', async () => {
    const ctx = await createTestApp()
    try {
      const { project, version, materialAssetIds } = await committedPrompt(ctx, { materials: 2 })
      const connection = await mockImageConnection(ctx, { maxReferenceImages: 1 })
      const created = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/art-projects/${project.id}/generations`,
        headers: { ...ctx.auth, 'idempotency-key': 'generation-key-0006' },
        payload: {
          promptVersionId: version.id,
          providerConnectionId: connection.id,
          count: 1,
          size: '512x896'
        }
      })
      expect(created.statusCode).toBe(202)
      const body = created.json<{
        generationId: string
        referenceAssetIds: string[]
        references: {
          mode: string
          sentAssetIds: string[]
          droppedAssetIds: string[]
          warnings: string[]
        }
      }>()
      expect(body.referenceAssetIds).toEqual([materialAssetIds[0]])
      expect(body.references.mode).toBe('truncated')
      expect(body.references.sentAssetIds).toEqual([materialAssetIds[0]])
      expect(body.references.droppedAssetIds).toEqual([materialAssetIds[1]])
      expect(body.references.warnings).toContain('reference_budget_exceeded')

      const generation = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/generations/${body.generationId}`,
        headers: ctx.auth
      })
      const snapshot = generation.json<{
        request: {
          compiled: { prompt: string; warnings: string[] }
          references: { requested: unknown[]; droppedAssetIds: string[] }
        }
      }>()
      expect(snapshot.request.references.requested).toHaveLength(2)
      expect(snapshot.request.references.droppedAssetIds).toEqual([materialAssetIds[1]])
      expect(snapshot.request.compiled.prompt).not.toContain('were not sent to the image model')
      expect(snapshot.request.compiled.warnings).toContain('reference_budget_exceeded')

      await ctx.services.jobs.tick()
      const finished = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/generations/${body.generationId}`,
        headers: ctx.auth
      })
      expect(finished.json<{ status: string }>().status).toBe('succeeded')
    } finally {
      await ctx.close()
    }
  })

  it('records safe provider diagnostics and restores the previous stage when generation fails', async () => {
    const upstream = createServer((_request, response) => {
      response.writeHead(503, { 'content-type': 'application/json' })
      response.end(
        JSON.stringify({
          error: { code: 'InternalServiceError', message: 'upstream body must not leak' }
        })
      )
    })
    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve))
    const port = (upstream.address() as AddressInfo).port
    const ctx = await createTestApp({
      secrets: new StaticSecretResolver(new Map([['sec_01J00000000000000000000000', 'sk-test-value']]))
    })
    try {
      const { project, version } = await committedPrompt(ctx)
      const provider = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/providers',
        headers: { ...ctx.auth, 'idempotency-key': 'provider-seedream-failure' },
        payload: {
          label: 'Seedream',
          kind: 'image',
          adapter: 'seedream',
          baseUrl: `http://127.0.0.1:${port}/v1`,
          model: 'test-seedream-model',
          secretRef: 'sec_01J00000000000000000000000',
          enabled: true,
          capabilities: SEEDREAM_CAPABILITIES
        }
      })
      expect(provider.statusCode).toBe(201)
      const connection = provider.json<{ id: string }>()
      const created = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/art-projects/${project.id}/generations`,
        headers: { ...ctx.auth, 'idempotency-key': 'generation-key-failure' },
        payload: {
          promptVersionId: version.id,
          providerConnectionId: connection.id,
          count: 1,
          size: '1024x1024'
        }
      })
      expect(created.statusCode).toBe(202)
      const createdBody = created.json<{ generationId: string; jobId: string }>()
      expect(ctx.db.prepare('select stage from art_projects where id = ?').get(project.id)).toEqual({
        stage: 'generating'
      })
      expect(
        ctx.db.prepare('select stage_before from generation_jobs where id = ?').get(createdBody.generationId)
      ).toEqual({ stage_before: 'prompt_ready' })

      await ctx.services.jobs.tick()

      const generation = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/generations/${createdBody.generationId}`,
        headers: ctx.auth
      })
      const body = generation.json<{
        status: string
        errorCode: string | null
        errorMessage: string | null
      }>()
      expect(body.status).toBe('failed')
      expect(body.errorCode).toBe('PROVIDER_UNAVAILABLE')
      expect(body.errorMessage).toContain('模型服务暂时不可用')
      expect(body.errorMessage).toContain('HTTP 503')
      expect(body.errorMessage).toContain('InternalServiceError')
      expect(JSON.stringify(body)).not.toContain('upstream body must not leak')

      const job = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/jobs/${createdBody.jobId}`,
        headers: ctx.auth
      })
      expect(job.json()).toMatchObject({
        status: 'failed',
        errorCode: 'PROVIDER_UNAVAILABLE',
        errorMessage: expect.stringContaining('HTTP 503')
      })
      const jobRow = ctx.db.prepare('select error_json from jobs where id = ?').get(createdBody.jobId) as {
        error_json: string
      }
      expect(jobRow.error_json).toContain('InternalServiceError')
      expect(jobRow.error_json).not.toContain('upstream body must not leak')

      const invocation = ctx.db
        .prepare(
          `select status, error_code, error_detail_json from provider_invocations
           where purpose = 'image.generate'`
        )
        .get() as { status: string; error_code: string; error_detail_json: string | null }
      expect(invocation.status).toBe('failed')
      expect(invocation.error_code).toBe('PROVIDER_UNAVAILABLE')
      expect(JSON.parse(invocation.error_detail_json!)).toEqual({
        status: 503,
        providerCode: 'InternalServiceError'
      })
      expect(invocation.error_detail_json).not.toContain('upstream body must not leak')

      expect(ctx.db.prepare('select stage from art_projects where id = ?').get(project.id)).toEqual({
        stage: 'prompt_ready'
      })
    } finally {
      await ctx.close()
      await new Promise<void>((resolve, reject) =>
        upstream.close((error) => (error ? reject(error) : resolve()))
      )
    }
  })

  it('restores the previous stage when a queued generation is cancelled', async () => {
    const ctx = await createTestApp()
    try {
      const { project, version } = await committedPrompt(ctx)
      const connection = await mockImageConnection(ctx)
      const created = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/art-projects/${project.id}/generations`,
        headers: { ...ctx.auth, 'idempotency-key': 'generation-key-cancel' },
        payload: {
          promptVersionId: version.id,
          providerConnectionId: connection.id,
          count: 1,
          size: '512x896'
        }
      })
      expect(created.statusCode).toBe(202)
      const createdBody = created.json<{ jobId: string }>()
      expect(ctx.db.prepare('select stage from art_projects where id = ?').get(project.id)).toEqual({
        stage: 'generating'
      })

      const cancelled = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/jobs/${createdBody.jobId}/cancel`,
        headers: ctx.auth
      })
      expect(cancelled.statusCode).toBe(200)
      expect(cancelled.json()).toMatchObject({ status: 'cancelled' })
      expect(ctx.db.prepare('select stage from art_projects where id = ?').get(project.id)).toEqual({
        stage: 'prompt_ready'
      })
    } finally {
      await ctx.close()
    }
  })

  it('restores the previous stage when lease recovery marks a generation unknown', async () => {
    const ctx = await createTestApp()
    try {
      const { project, version } = await committedPrompt(ctx)
      const connection = await mockImageConnection(ctx)
      const created = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/art-projects/${project.id}/generations`,
        headers: { ...ctx.auth, 'idempotency-key': 'generation-key-unknown' },
        payload: {
          promptVersionId: version.id,
          providerConnectionId: connection.id,
          count: 1,
          size: '512x896'
        }
      })
      expect(created.statusCode).toBe(202)
      const createdBody = created.json<{ jobId: string }>()
      ctx.db
        .prepare(
          `update jobs set status = 'running', lease_owner = 'dead', lease_until = 1, attempts = 1
           where id = ?`
        )
        .run(createdBody.jobId)

      expect(ctx.services.jobs.recoverExpiredLeases()).toBe(1)
      expect(ctx.services.jobs.get(createdBody.jobId)).toMatchObject({
        status: 'unknown_outcome',
        errorCode: 'UNKNOWN_OUTCOME'
      })
      expect(ctx.db.prepare('select stage from art_projects where id = ?').get(project.id)).toEqual({
        stage: 'prompt_ready'
      })
    } finally {
      await ctx.close()
    }
  })

  it('exposes generation parameters, compile diagnostics and project history', async () => {
    const ctx = await createTestApp()
    try {
      const prepared = await committedPrompt(ctx)
      const connection = await mockImageConnection(ctx)
      const created = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/art-projects/${prepared.project.id}/generations`,
        headers: { ...ctx.auth, 'idempotency-key': 'gen-dto-0001' },
        payload: {
          promptVersionId: prepared.version.id,
          providerConnectionId: connection.id,
          count: 2,
          size: '512x896',
          seed: 42
        }
      })
      expect(created.statusCode).toBe(202)
      const generationId = created.json<{ generationId: string }>().generationId
      await ctx.services.jobs.tick()
      const detail = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/generations/${generationId}`,
        headers: ctx.auth
      })
      const dto = detail.json<{
        count: number
        size: string
        seed: number | null
        droppedBlockIds: string[]
        compiledWarnings: string[]
      }>()
      expect(dto.count).toBe(2)
      expect(dto.size).toBe('512x896')
      expect(dto.seed).toBe(42)
      expect(Array.isArray(dto.droppedBlockIds)).toBe(true)
      expect(Array.isArray(dto.compiledWarnings)).toBe(true)

      const list = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/art-projects/${prepared.project.id}/generations?limit=10`,
        headers: ctx.auth
      })
      expect(list.statusCode).toBe(200)
      const items = list.json<{ items: Array<{ id: string }> }>().items
      expect(items.map((item) => item.id)).toContain(generationId)
    } finally {
      await ctx.close()
    }
  })

  it('discards ready candidates and stays idempotent', async () => {
    const ctx = await createTestApp()
    try {
      const prepared = await committedPrompt(ctx)
      const connection = await mockImageConnection(ctx)
      const created = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/art-projects/${prepared.project.id}/generations`,
        headers: { ...ctx.auth, 'idempotency-key': 'gen-discard-0001' },
        payload: {
          promptVersionId: prepared.version.id,
          providerConnectionId: connection.id,
          count: 2,
          size: '512x896'
        }
      })
      const generationId = created.json<{ generationId: string }>().generationId
      await ctx.services.jobs.tick()

      const first = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/generations/${generationId}/discard`,
        headers: { ...ctx.auth, 'idempotency-key': 'gen-discard-0002' },
        payload: {}
      })
      expect(first.statusCode).toBe(200)
      expect(
        first
          .json<{ candidates: Array<{ status: string }> }>()
          .candidates.every((candidate) => candidate.status === 'rejected')
      ).toBe(true)

      const second = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/generations/${generationId}/discard`,
        headers: { ...ctx.auth, 'idempotency-key': 'gen-discard-0002' },
        payload: {}
      })
      expect(second.statusCode).toBe(200)
    } finally {
      await ctx.close()
    }
  })
})
