import { describe, expect, it, vi } from 'vitest'
import { createMockChatProvider } from '@agent2live/providers'
import { createPromptReverseJob } from '../src/jobs/prompt-reverse'
import { createTestApp } from './helpers/app'
import { multipartPayload, postMetadataOnlyInput, seedProject, specWithAsset } from './helpers/seed-prompt'
import { png } from './helpers/files'

async function prepareDraft(ctx: Awaited<ReturnType<typeof createTestApp>>) {
  const { project } = await seedProject(ctx)
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
  const source = await png(320, 480)
  const faceBytes = new Uint8Array(source.length)
  faceBytes.set(source)
  form.append('file_face', new Blob([faceBytes], { type: 'image/png' }), 'face.png')
  const packed = await multipartPayload(form)
  const input = await ctx.app.inject({
    method: 'POST',
    url: `/api/v1/art-projects/${project.id}/prompt-inputs`,
    headers: { ...ctx.auth, 'content-type': packed.contentType },
    payload: packed.payload
  })
  const body = input.json<{
    submission: { id: string; materials: Array<{ assetId: string }> }
    draft: { id: string; revision: number; rowVersion: number }
  }>()
  const assetId = body.submission.materials[0]!.assetId
  const saved = await ctx.app.inject({
    method: 'PATCH',
    url: `/api/v1/art-projects/${project.id}/prompt-drafts/${body.draft.id}`,
    headers: { ...ctx.auth, 'if-match': `"${body.draft.rowVersion}"` },
    payload: { state: specWithAsset(assetId) }
  })
  expect(saved.statusCode).toBe(200)
  const draft = saved.json<{ id: string; revision: number; rowVersion: number }>()
  return { project, input: body, draft, assetId }
}

let providerCreateSeq = 0
function nextProviderKey(prefix: string): string {
  providerCreateSeq += 1
  return `${prefix}-${String(providerCreateSeq).padStart(4, '0')}`
}

async function createMockChat(ctx: Awaited<ReturnType<typeof createTestApp>>) {
  const response = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/providers',
    headers: { ...ctx.auth, 'idempotency-key': nextProviderKey('provider-mock-chat') },
    payload: {
      label: 'Mock chat',
      kind: 'chat',
      adapter: 'mock',
      capabilities: {
        schemaVersion: 'provider-capabilities/1',
        chat: { maxImages: 8, maxPromptChars: 20_000, supportsVision: true }
      }
    }
  })
  return response.json<{ id: string }>()
}

async function enqueueReverse(
  ctx: Awaited<ReturnType<typeof createTestApp>>,
  projectId: string,
  connectionId: string,
  key: string
) {
  return ctx.app.inject({
    method: 'POST',
    url: `/api/v1/art-projects/${projectId}/prompt-reverse`,
    headers: { ...ctx.auth, 'idempotency-key': key },
    payload: { providerConnectionId: connectionId }
  })
}

async function readyResult(ctx: Awaited<ReturnType<typeof createTestApp>>, key: string) {
  const { project, draft, assetId } = await prepareDraft(ctx)
  const connection = await createMockChat(ctx)
  const created = await enqueueReverse(ctx, project.id, connection.id, key)
  expect(created.statusCode).toBe(202)
  const jobId = created.json<{ jobId: string }>().jobId
  await ctx.services.jobs.tick()
  const job = await ctx.app.inject({ method: 'GET', url: `/api/v1/jobs/${jobId}`, headers: ctx.auth })
  expect(job.json()).toMatchObject({ status: 'succeeded' })
  const reverseResultId = job.json<{ result: { reverseResultId: string } }>().result.reverseResultId
  return { project, draft, assetId, connection, jobId, reverseResultId }
}

describe('prompt reverse', () => {
  it('allows slow reasoning models enough time to return a prompt spec', async () => {
    const ctx = await createTestApp()
    try {
      const { project } = await prepareDraft(ctx)
      const connection = await createMockChat(ctx)
      let timeoutMs: number | undefined
      let maxTokens: number | undefined
      const mock = createMockChatProvider()
      expect(createPromptReverseJob(ctx.services.reverse).timeoutMs).toBeGreaterThanOrEqual(240_000)
      vi.spyOn(ctx.services.providerRegistry, 'chat').mockResolvedValue({
        kind: 'chat',
        generate: (request, context) => {
          timeoutMs = context.timeoutMs
          maxTokens = request.maxTokens
          return mock.generate(request, context)
        }
      })

      const created = await enqueueReverse(ctx, project.id, connection.id, 'reverse-timeout-0001')
      await ctx.services.jobs.tick()

      expect(timeoutMs).toBeGreaterThanOrEqual(180_000)
      expect(maxTokens).toBeGreaterThanOrEqual(12_000)
      expect(created.statusCode).toBe(202)
    } finally {
      await ctx.close()
    }
  })

  it('runs a mock reverse job, stores a ready candidate, and applies it with If-Match', async () => {
    const ctx = await createTestApp()
    try {
      const { project, draft } = await prepareDraft(ctx)
      const connection = await createMockChat(ctx)
      const created = await enqueueReverse(ctx, project.id, connection.id, 'reverse-key-0001')
      expect(created.statusCode).toBe(202)
      const createdBody = created.json<{
        jobId: string
        baseDraftRevision: number
        baseDraftRowVersion: number
      }>()
      expect(createdBody.baseDraftRevision).toBe(draft.revision)
      expect(createdBody.baseDraftRowVersion).toBe(draft.rowVersion)
      expect(created.headers.location).toBe(`/api/v1/jobs/${createdBody.jobId}`)
      const jobId = createdBody.jobId

      await ctx.services.jobs.tick()
      const job = await ctx.app.inject({ method: 'GET', url: `/api/v1/jobs/${jobId}`, headers: ctx.auth })
      expect(job.json()).toMatchObject({ status: 'succeeded' })
      const reverseResultId = job.json<{ result: { reverseResultId: string } }>().result.reverseResultId

      const detail = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/prompt-reverse-results/${reverseResultId}`,
        headers: ctx.auth
      })
      const result = detail.json<{
        status: string
        contentHash: string
        state: {
          blocks: Array<{ locked: boolean; requirementRefs: string[] }>
          negativeBlocks: Array<{ requirementRefs: string[] }>
        }
      }>()
      expect(result.status).toBe('ready')
      expect(result.contentHash).toMatch(/^[0-9a-f]{64}$/)
      expect(
        result.state.blocks.some((block) => block.locked && block.requirementRefs.includes('req_identity'))
      ).toBe(true)
      expect(result.state.negativeBlocks.some((block) => block.requirementRefs.includes('req_avoid'))).toBe(
        true
      )

      const applied = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/prompt-reverse-results/${reverseResultId}/apply`,
        headers: { ...ctx.auth, 'if-match': `"${draft.rowVersion}"` },
        payload: {}
      })
      expect(applied.statusCode).toBe(200)
      const appliedBody = applied.json<{
        result: { status: string }
        draft: { rowVersion: number; revision: number }
      }>()
      expect(appliedBody.result.status).toBe('applied')
      expect(appliedBody.draft.rowVersion).toBe(draft.rowVersion + 1)

      const again = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/prompt-reverse-results/${reverseResultId}/apply`,
        headers: { ...ctx.auth, 'if-match': `"${appliedBody.draft.rowVersion}"` },
        payload: {}
      })
      expect(again.statusCode).toBe(409)
      expect(again.json()).toMatchObject({ error: { code: 'PROMPT_REVERSE_RESOLVED' } })
    } finally {
      await ctx.close()
    }
  })

  it('feeds the pinned brief to reverse and preserves its locked projection', async () => {
    const ctx = await createTestApp()
    try {
      const { project } = await seedProject(ctx)
      const input = await postMetadataOnlyInput(ctx, project.id, {
        characterBrief: {
          schemaVersion: 'character-brief/1',
          identity: { fullName: '雾原铃' },
          appearance: { hair: '银灰色短发' },
          personality: { traits: ['谨慎'] }
        },
        requirements: [{ id: 'req_identity', text: '银灰短发', strength: 'must' }],
        materials: []
      })
      expect(input.statusCode).toBe(201)
      const body = input.json<{ submission: { characterBriefVersionId: string } }>()
      const connection = await createMockChat(ctx)
      const created = await enqueueReverse(ctx, project.id, connection.id, 'reverse-key-brief-0001')
      const jobId = created.json<{ jobId: string }>().jobId
      await ctx.services.jobs.tick()
      const job = await ctx.app.inject({ method: 'GET', url: `/api/v1/jobs/${jobId}`, headers: ctx.auth })
      expect(job.json()).toMatchObject({ status: 'succeeded' })
      const resultId = job.json<{ result: { reverseResultId: string } }>().result.reverseResultId
      const detail = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/prompt-reverse-results/${resultId}`,
        headers: ctx.auth
      })
      const result = detail.json<{
        state: {
          characterBriefVersionId?: string
          blocks: Array<{ id: string; source: string; locked: boolean; text: string }>
        }
      }>().state
      expect(result.characterBriefVersionId).toBe(body.submission.characterBriefVersionId)
      const hair = result.blocks.find((block) => block.id === 'brief.appearance.hair')
      expect(hair?.locked).toBe(true)
      expect(hair?.text).toContain('银灰色短发')
      expect(JSON.stringify(result.blocks)).not.toContain('谨慎')
      expect(result.blocks.some((block) => block.id === 'subject.identity')).toBe(true)
    } finally {
      await ctx.close()
    }
  })

  it('is idempotent for the same key and payload and returns the same job', async () => {
    const ctx = await createTestApp()
    try {
      const { project } = await prepareDraft(ctx)
      const connection = await createMockChat(ctx)
      const first = await enqueueReverse(ctx, project.id, connection.id, 'reverse-key-0002')
      const second = await enqueueReverse(ctx, project.id, connection.id, 'reverse-key-0002')
      expect(first.statusCode).toBe(202)
      expect(second.statusCode).toBe(202)
      expect(second.json<{ jobId: string }>().jobId).toBe(first.json<{ jobId: string }>().jobId)
    } finally {
      await ctx.close()
    }
  })

  it('rejects apply after the draft changed and allows discard only while ready', async () => {
    const ctx = await createTestApp()
    try {
      const { project, draft, assetId, reverseResultId } = await readyResult(ctx, 'reverse-key-0003')

      const changedInput = specWithAsset(assetId) as { blocks: Array<{ text: string }> }
      changedInput.blocks[1]!.text = '清爽的厚涂插画'
      const changed = await ctx.app.inject({
        method: 'PATCH',
        url: `/api/v1/art-projects/${project.id}/prompt-drafts/${draft.id}`,
        headers: { ...ctx.auth, 'if-match': `"${draft.rowVersion}"` },
        payload: { state: changedInput }
      })
      expect(changed.statusCode).toBe(200)
      const changedDraft = changed.json<{ rowVersion: number }>()

      const stale = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/prompt-reverse-results/${reverseResultId}/apply`,
        headers: { ...ctx.auth, 'if-match': `"${draft.rowVersion}"` },
        payload: {}
      })
      expect(stale.statusCode).toBe(409)
      expect(stale.json()).toMatchObject({ error: { code: 'PROMPT_REVERSE_STALE' } })

      const discarded = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/prompt-reverse-results/${reverseResultId}/discard`,
        headers: { ...ctx.auth, 'if-match': `"${changedDraft.rowVersion}"` },
        payload: {}
      })
      expect(discarded.statusCode).toBe(200)
      expect(discarded.json()).toMatchObject({ status: 'discarded' })

      const list = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/art-projects/${project.id}/prompt-reverse-results?status=discarded`,
        headers: ctx.auth
      })
      const items = list.json<{ items: Array<{ state: unknown; status: string }> }>().items
      expect(items).toHaveLength(1)
      expect(items[0]?.status).toBe('discarded')
      expect(items[0]?.state).toBeNull()
    } finally {
      await ctx.close()
    }
  })

  it('guards Idempotency-Key, locked drafts, If-Match, and missing results', async () => {
    const ctx = await createTestApp()
    try {
      const { project, draft, assetId } = await prepareDraft(ctx)
      const connection = await createMockChat(ctx)

      const missingKey = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/art-projects/${project.id}/prompt-reverse`,
        headers: ctx.auth,
        payload: { providerConnectionId: connection.id }
      })
      expect(missingKey.statusCode).toBe(428)
      expect(missingKey.json()).toMatchObject({ error: { code: 'IDEMPOTENCY_KEY_REQUIRED' } })

      const locked = specWithAsset(assetId) as { lockAll: boolean }
      locked.lockAll = true
      const saved = await ctx.app.inject({
        method: 'PATCH',
        url: `/api/v1/art-projects/${project.id}/prompt-drafts/${draft.id}`,
        headers: { ...ctx.auth, 'if-match': `"${draft.rowVersion}"` },
        payload: { state: locked }
      })
      expect(saved.statusCode).toBe(200)
      const lockedResponse = await enqueueReverse(ctx, project.id, connection.id, 'reverse-key-0004')
      expect(lockedResponse.statusCode).toBe(423)
      expect(lockedResponse.json()).toMatchObject({ error: { code: 'PROMPT_BLOCK_LOCKED' } })
      expect(ctx.db.prepare('select count(*) as n from jobs').get()).toEqual({ n: 0 })

      const missing = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/prompt-reverse-results/prv_01J00000000000000000000000',
        headers: ctx.auth
      })
      expect(missing.statusCode).toBe(404)
      expect(missing.json()).toMatchObject({ error: { code: 'RESOURCE_NOT_FOUND' } })
    } finally {
      await ctx.close()
    }
  })

  it('requires a single If-Match header when applying', async () => {
    const ctx = await createTestApp()
    try {
      const { draft, reverseResultId } = await readyResult(ctx, 'reverse-key-0005')

      const missing = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/prompt-reverse-results/${reverseResultId}/apply`,
        headers: ctx.auth,
        payload: {}
      })
      expect(missing.statusCode).toBe(428)
      expect(missing.json()).toMatchObject({ error: { code: 'PRECONDITION_REQUIRED' } })

      const repeated = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/prompt-reverse-results/${reverseResultId}/apply`,
        headers: { ...ctx.auth, 'if-match': ['"1"', '"2"'] } as unknown as Record<string, string>,
        payload: {}
      })
      expect(repeated.statusCode).toBe(400)
      expect(repeated.json()).toMatchObject({
        error: { code: 'REQUEST_INVALID', details: { reason: 'if_match_multiple' } }
      })

      const wrongVersion = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/prompt-reverse-results/${reverseResultId}/apply`,
        headers: { ...ctx.auth, 'if-match': `"${draft.rowVersion + 10}"` },
        payload: {}
      })
      expect(wrongVersion.statusCode).toBe(409)
      expect(wrongVersion.json()).toMatchObject({ error: { code: 'ROW_VERSION_CONFLICT' } })
    } finally {
      await ctx.close()
    }
  })
})
