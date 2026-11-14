import { describe, expect, it } from 'vitest'
import { createTestApp } from './helpers/app'
import { multipartPayload, seedProject, specWithAsset } from './helpers/seed-prompt'
import { png } from './helpers/files'

type Ctx = Awaited<ReturnType<typeof createTestApp>>

async function prepareDraft(ctx: Ctx) {
  const { project } = await seedProject(ctx)
  const form = new FormData()
  form.append(
    'metadata',
    JSON.stringify({
      characterBrief: {
        schemaVersion: 'character-brief/1',
        identity: { fullName: '雾原铃' },
        appearance: { hair: '银灰色短发' },
        personality: { traits: ['谨慎'] }
      },
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
  expect(input.statusCode).toBe(201)
  const body = input.json<{
    submission: { id: string; materials: Array<{ assetId: string }> }
    draft: { id: string; rowVersion: number }
  }>()
  const assetId = body.submission.materials[0]!.assetId
  const saved = await ctx.app.inject({
    method: 'PATCH',
    url: `/api/v1/art-projects/${project.id}/prompt-drafts/${body.draft.id}`,
    headers: { ...ctx.auth, 'if-match': `"${body.draft.rowVersion}"` },
    payload: { state: specWithAsset(assetId) }
  })
  expect(saved.statusCode).toBe(200)
  return {
    project,
    draft: body.draft,
    assetId,
    saved: saved.json<{ id: string; rowVersion: number }>()
  }
}

let providerCreateSeq = 0
function nextProviderKey(prefix: string): string {
  providerCreateSeq += 1
  return `${prefix}-${String(providerCreateSeq).padStart(4, '0')}`
}

async function createMockChat(ctx: Ctx) {
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

async function enqueueDraftSuggestion(
  ctx: Ctx,
  projectId: string,
  draftId: string,
  connectionId: string,
  key: string
) {
  return ctx.app.inject({
    method: 'POST',
    url: `/api/v1/art-projects/${projectId}/prompt-drafts/${draftId}/suggestions`,
    headers: { ...ctx.auth, 'idempotency-key': key },
    payload: { providerConnectionId: connectionId, intent: '增加柔和逆光' }
  })
}

async function suggestionFromJob(ctx: Ctx, jobId: string) {
  const job = await ctx.app.inject({ method: 'GET', url: `/api/v1/jobs/${jobId}`, headers: ctx.auth })
  return job.json<{ status: string; result: { suggestionId: string } }>()
}

describe('prompt suggestions', () => {
  it('generates and accepts a draft suggestion into a new draft revision', async () => {
    const ctx = await createTestApp()
    try {
      const prepared = await prepareDraft(ctx)
      const connection = await createMockChat(ctx)
      const created = await enqueueDraftSuggestion(
        ctx,
        prepared.project.id,
        prepared.draft.id,
        connection.id,
        'suggest-key-0001'
      )
      expect(created.statusCode).toBe(202)
      const jobId = created.json<{ jobId: string }>().jobId
      await ctx.services.jobs.tick()
      const job = await suggestionFromJob(ctx, jobId)
      expect(job.status).toBe('succeeded')

      const detail = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/prompt-suggestions/${job.result.suggestionId}`,
        headers: ctx.auth
      })
      const suggestion = detail.json<{
        status: string
        operations: unknown[]
        baseDraftRowVersion: number
      }>()
      expect(suggestion.status).toBe('proposed')
      expect(suggestion.operations).toHaveLength(1)

      const accepted = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/prompt-suggestions/${job.result.suggestionId}/accept`,
        headers: ctx.auth,
        payload: { expectedDraftRowVersion: prepared.saved.rowVersion }
      })
      expect(accepted.statusCode).toBe(200)
      const acceptedBody = accepted.json<{
        suggestion: { status: string; acceptedDraftId: string }
        draft: { rowVersion: number; state: { blocks: Array<{ id: string; locked: boolean; text: string }> } }
      }>()
      expect(acceptedBody.suggestion.status).toBe('accepted')
      expect(acceptedBody.suggestion.acceptedDraftId).toBe(prepared.draft.id)
      expect(acceptedBody.draft.state.blocks.some((block) => block.id.startsWith('ai.suggestion.mock'))).toBe(
        true
      )
      const hair = acceptedBody.draft.state.blocks.find((block) => block.id === 'brief.appearance.hair')
      expect(hair?.locked).toBe(true)
      expect(hair?.text).toContain('银灰色短发')
      expect(JSON.stringify(acceptedBody.draft.state.blocks)).not.toContain('谨慎')
    } finally {
      await ctx.close()
    }
  })

  it('creates a fresh draft when accepting a suggestion based on an immutable version', async () => {
    const ctx = await createTestApp()
    try {
      const prepared = await prepareDraft(ctx)
      const commit = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/art-projects/${prepared.project.id}/prompt-drafts/${prepared.draft.id}/commit`,
        headers: {
          ...ctx.auth,
          'if-match': `"${prepared.saved.rowVersion}"`,
          'idempotency-key': 'commit-suggest-0001'
        },
        payload: {}
      })
      expect(commit.statusCode).toBe(201)
      const version = commit.json<{ version: { id: string } }>().version
      const connection = await createMockChat(ctx)
      const created = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/prompt-versions/${version.id}/suggestions`,
        headers: { ...ctx.auth, 'idempotency-key': 'suggest-key-0002' },
        payload: { providerConnectionId: connection.id, intent: '让构图更居中' }
      })
      expect(created.statusCode).toBe(202)
      await ctx.services.jobs.tick()
      const completed = await suggestionFromJob(ctx, created.json<{ jobId: string }>().jobId)
      expect(completed.status).toBe('succeeded')

      const accepted = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/prompt-suggestions/${completed.result.suggestionId}/accept`,
        headers: ctx.auth,
        payload: { expectedDraftRowVersion: null }
      })
      expect(accepted.statusCode).toBe(200)
      const workspace = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/art-projects/${prepared.project.id}/prompt`,
        headers: ctx.auth
      })
      const activeDraft = workspace.json<{
        activeDraft: { state: { blocks: Array<{ id: string }> } } | null
      }>().activeDraft
      expect(activeDraft?.state.blocks.some((block) => block.id.startsWith('ai.suggestion.mock'))).toBe(true)
    } finally {
      await ctx.close()
    }
  })

  it('marks a suggestion stale when its base draft changed before accept', async () => {
    const ctx = await createTestApp()
    try {
      const prepared = await prepareDraft(ctx)
      const connection = await createMockChat(ctx)
      const created = await enqueueDraftSuggestion(
        ctx,
        prepared.project.id,
        prepared.draft.id,
        connection.id,
        'suggest-key-0003'
      )
      const jobId = created.json<{ jobId: string }>().jobId
      await ctx.services.jobs.tick()
      const completed = await suggestionFromJob(ctx, jobId)
      expect(completed.status).toBe('succeeded')

      // Re-saving identical content would keep the hash and surface ROW_VERSION_CONFLICT instead;
      // editing an unlocked block proves the base hash guard runs before the row-version guard.
      const changedInput = specWithAsset(prepared.assetId) as {
        blocks: Array<{ id: string; text: string }>
      }
      changedInput.blocks.find((block) => block.id === 'style.rendering')!.text = '清爽的厚涂插画，柔和光晕'
      const changed = await ctx.app.inject({
        method: 'PATCH',
        url: `/api/v1/art-projects/${prepared.project.id}/prompt-drafts/${prepared.draft.id}`,
        headers: { ...ctx.auth, 'if-match': `"${prepared.saved.rowVersion}"` },
        payload: { state: changedInput }
      })
      expect(changed.statusCode).toBe(200)

      const accept = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/prompt-suggestions/${completed.result.suggestionId}/accept`,
        headers: ctx.auth,
        payload: { expectedDraftRowVersion: prepared.saved.rowVersion }
      })
      expect(accept.statusCode).toBe(409)
      expect(accept.json()).toMatchObject({ error: { code: 'PROMPT_BASE_STALE' } })
      const detail = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/prompt-suggestions/${completed.result.suggestionId}`,
        headers: ctx.auth
      })
      expect(detail.json()).toMatchObject({ status: 'stale' })
    } finally {
      await ctx.close()
    }
  })

  it('rejects a proposal once and refuses to accept it afterwards', async () => {
    const ctx = await createTestApp()
    try {
      const prepared = await prepareDraft(ctx)
      const connection = await createMockChat(ctx)
      const created = await enqueueDraftSuggestion(
        ctx,
        prepared.project.id,
        prepared.draft.id,
        connection.id,
        'suggest-key-0004'
      )
      const jobId = created.json<{ jobId: string }>().jobId
      await ctx.services.jobs.tick()
      const completed = await suggestionFromJob(ctx, jobId)
      expect(completed.status).toBe('succeeded')

      const rejected = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/prompt-suggestions/${completed.result.suggestionId}/reject`,
        headers: ctx.auth,
        payload: {}
      })
      expect(rejected.statusCode).toBe(200)
      expect(rejected.json()).toMatchObject({ status: 'rejected' })

      const accept = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/prompt-suggestions/${completed.result.suggestionId}/accept`,
        headers: ctx.auth,
        payload: { expectedDraftRowVersion: prepared.saved.rowVersion }
      })
      expect(accept.statusCode).toBe(409)
      expect(accept.json()).toMatchObject({ error: { code: 'PROMPT_SUGGESTION_RESOLVED' } })
    } finally {
      await ctx.close()
    }
  })
})
