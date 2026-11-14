import { describe, expect, it } from 'vitest'
import { createTestApp } from './helpers/app'
import { multipartPayload, postMetadataOnlyInput, seedProject, specWithAsset } from './helpers/seed-prompt'
import { png } from './helpers/files'

async function postInput(
  ctx: Awaited<ReturnType<typeof createTestApp>>,
  projectId: string,
  headers: Record<string, string> = {}
) {
  const form = new FormData()
  form.append(
    'metadata',
    JSON.stringify({
      globalNotes: '保持清透',
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
  const { payload, contentType } = await multipartPayload(form)
  return ctx.app.inject({
    method: 'POST',
    url: `/api/v1/art-projects/${projectId}/prompt-inputs`,
    headers: { ...ctx.auth, 'content-type': contentType, ...headers },
    payload
  })
}

describe('prompt drafts and versions', () => {
  it('ingests input, saves a draft, and commits an immutable version', async () => {
    const ctx = await createTestApp()
    try {
      const { project } = await seedProject(ctx)
      const input = await postInput(ctx, project.id)
      expect(input.statusCode).toBe(201)
      const inputBody = input.json<{
        submission: { id: string; revision: number; materials: Array<{ assetId: string }> }
        draft: { id: string; revision: number; rowVersion: number; inputSubmissionId: string }
        warnings: string[]
      }>()
      expect(inputBody.submission.revision).toBe(1)
      expect(inputBody.submission.materials).toHaveLength(1)
      expect(inputBody.draft.inputSubmissionId).toBe(inputBody.submission.id)
      expect(inputBody.draft.revision).toBe(1)

      const assetId = inputBody.submission.materials[0]!.assetId
      const saved = await ctx.app.inject({
        method: 'PATCH',
        url: `/api/v1/art-projects/${project.id}/prompt-drafts/${inputBody.draft.id}`,
        headers: { ...ctx.auth, 'if-match': `"${inputBody.draft.rowVersion}"` },
        payload: { state: specWithAsset(assetId) }
      })
      expect(saved.statusCode).toBe(200)
      const savedDraft = saved.json<{ rowVersion: number; revision: number; contentHash: string }>()
      expect(savedDraft.revision).toBe(2)
      expect(savedDraft.contentHash).toMatch(/^[0-9a-f]{64}$/)

      const commit = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/art-projects/${project.id}/prompt-drafts/${inputBody.draft.id}/commit`,
        headers: {
          ...ctx.auth,
          'if-match': `"${savedDraft.rowVersion}"`,
          'idempotency-key': 'commit-0001'
        },
        payload: { acknowledgeUncoveredRequirements: false }
      })
      expect(commit.statusCode).toBe(201)
      const version = commit.json<{
        version: {
          id: string
          versionNumber: number
          contentHash: string
          parentVersionId: string | null
          state: { contentHash?: string; parentVersionId?: string | null }
        }
      }>().version
      expect(version.versionNumber).toBe(1)
      expect(version.state.contentHash).toBe(version.contentHash)
      expect(version.state.parentVersionId).toBeNull()

      const workspace = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/art-projects/${project.id}/prompt`,
        headers: ctx.auth
      })
      expect(workspace.json()).toMatchObject({
        activeDraft: null,
        activePromptVersion: { id: version.id, versionNumber: 1 }
      })
    } finally {
      await ctx.close()
    }
  })

  it('creates a new draft from the active version and rejects a second active draft', async () => {
    const ctx = await createTestApp()
    try {
      const { project } = await seedProject(ctx)
      const input = await postInput(ctx, project.id)
      const body = input.json<{
        draft: { id: string; rowVersion: number; inputSubmissionId: string }
        submission: { materials: Array<{ assetId: string }> }
      }>()
      const assetId = body.submission.materials[0]!.assetId
      const saved = await ctx.app.inject({
        method: 'PATCH',
        url: `/api/v1/art-projects/${project.id}/prompt-drafts/${body.draft.id}`,
        headers: { ...ctx.auth, 'if-match': `"${body.draft.rowVersion}"` },
        payload: { state: specWithAsset(assetId) }
      })
      const savedDraft = saved.json<{ rowVersion: number }>()
      const firstCommit = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/art-projects/${project.id}/prompt-drafts/${body.draft.id}/commit`,
        headers: {
          ...ctx.auth,
          'if-match': `"${savedDraft.rowVersion}"`,
          'idempotency-key': 'commit-0002'
        },
        payload: {}
      })
      expect(firstCommit.statusCode).toBe(201)
      const firstVersion = firstCommit.json<{ version: { id: string } }>().version

      const created = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/art-projects/${project.id}/prompt-drafts`,
        headers: { ...ctx.auth, 'idempotency-key': 'draft-0001' },
        payload: { from: 'active_version' }
      })
      expect(created.statusCode).toBe(201)
      const draft = created.json<{
        id: string
        rowVersion: number
        inputSubmissionId: string
        state: { blocks: unknown[] }
        baseVersionId: string
      }>()
      expect(draft.inputSubmissionId).toBe(body.draft.inputSubmissionId)
      expect(draft.baseVersionId).toMatch(/^pv_/)
      expect(draft.state.blocks.length).toBeGreaterThan(0)

      const conflict = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/art-projects/${project.id}/prompt-drafts`,
        headers: { ...ctx.auth, 'idempotency-key': 'draft-0002' },
        payload: { from: 'empty' }
      })
      expect(conflict.statusCode).toBe(409)
      expect(conflict.json()).toMatchObject({ error: { code: 'PROMPT_DRAFT_EXISTS' } })

      const secondCommit = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/art-projects/${project.id}/prompt-drafts/${draft.id}/commit`,
        headers: {
          ...ctx.auth,
          'if-match': `"${draft.rowVersion}"`,
          'idempotency-key': 'commit-0003'
        },
        payload: {}
      })
      expect(secondCommit.statusCode).toBe(201)
      const secondVersion = secondCommit.json<{
        version: {
          contentHash: string
          parentVersionId: string | null
          state: { contentHash?: string; parentVersionId?: string | null }
        }
      }>().version
      expect(secondVersion.parentVersionId).toBe(firstVersion.id)
      expect(secondVersion.state.parentVersionId).toBe(firstVersion.id)
      expect(secondVersion.state.contentHash).toBe(secondVersion.contentHash)
    } finally {
      await ctx.close()
    }
  })

  it('requires input and blocks uncovered mandatory requirements unless acknowledged', async () => {
    const ctx = await createTestApp()
    try {
      const { project } = await seedProject(ctx)
      const empty = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/art-projects/${project.id}/prompt-drafts`,
        headers: { ...ctx.auth, 'idempotency-key': 'draft-0003' },
        payload: { from: 'empty' }
      })
      const draft = empty.json<{ id: string; rowVersion: number }>()
      const noInput = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/art-projects/${project.id}/prompt-drafts/${draft.id}/commit`,
        headers: {
          ...ctx.auth,
          'if-match': `"${draft.rowVersion}"`,
          'idempotency-key': 'commit-0004'
        },
        payload: {}
      })
      expect(noInput.statusCode).toBe(409)
      expect(noInput.json()).toMatchObject({ error: { code: 'PROMPT_INPUT_REQUIRED' } })

      const input = await postInput(ctx, project.id, { 'if-match': `"${draft.rowVersion}"` })
      expect(input.statusCode).toBe(201)
      const updated = input.json<{ draft: { id: string; rowVersion: number } }>().draft
      const assetId = input.json<{ submission: { materials: Array<{ assetId: string }> } }>().submission
        .materials[0]!.assetId
      const state = specWithAsset(assetId) as {
        blocks: Array<{ requirementRefs: string[] }>
        sourceRequirements: Array<{ id: string }>
      }
      state.blocks[0]!.requirementRefs = []
      const saved = await ctx.app.inject({
        method: 'PATCH',
        url: `/api/v1/art-projects/${project.id}/prompt-drafts/${updated.id}`,
        headers: { ...ctx.auth, 'if-match': `"${updated.rowVersion}"` },
        payload: { state }
      })
      expect(saved.statusCode).toBe(200)
      const savedDraft = saved.json<{ rowVersion: number }>()
      const uncovered = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/art-projects/${project.id}/prompt-drafts/${updated.id}/commit`,
        headers: {
          ...ctx.auth,
          'if-match': `"${savedDraft.rowVersion}"`,
          'idempotency-key': 'commit-0005'
        },
        payload: { acknowledgeUncoveredRequirements: false }
      })
      expect(uncovered.statusCode).toBe(422)
      expect(uncovered.json()).toMatchObject({ error: { code: 'PROMPT_REQUIREMENT_UNCOVERED' } })

      const acknowledged = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/art-projects/${project.id}/prompt-drafts/${updated.id}/commit`,
        headers: {
          ...ctx.auth,
          'if-match': `"${savedDraft.rowVersion}"`,
          'idempotency-key': 'commit-0006'
        },
        payload: { acknowledgeUncoveredRequirements: true }
      })
      expect(acknowledged.statusCode).toBe(201)
    } finally {
      await ctx.close()
    }
  })

  it('rejects a stale draft save and refuses to modify a committed version', async () => {
    const ctx = await createTestApp()
    try {
      const { project } = await seedProject(ctx)
      const input = await postInput(ctx, project.id)
      const body = input.json<{ draft: { id: string; rowVersion: number } }>().draft
      const assetId = input.json<{ submission: { materials: Array<{ assetId: string }> } }>().submission
        .materials[0]!.assetId
      const first = await ctx.app.inject({
        method: 'PATCH',
        url: `/api/v1/art-projects/${project.id}/prompt-drafts/${body.id}`,
        headers: { ...ctx.auth, 'if-match': `"${body.rowVersion}"` },
        payload: { state: specWithAsset(assetId) }
      })
      expect(first.statusCode).toBe(200)
      const stale = await ctx.app.inject({
        method: 'PATCH',
        url: `/api/v1/art-projects/${project.id}/prompt-drafts/${body.id}`,
        headers: { ...ctx.auth, 'if-match': `"${body.rowVersion}"` },
        payload: { state: specWithAsset(assetId) }
      })
      expect(stale.statusCode).toBe(409)
      expect(stale.json()).toMatchObject({ error: { code: 'ROW_VERSION_CONFLICT' } })

      const versionId = (
        await ctx.app.inject({
          method: 'POST',
          url: `/api/v1/art-projects/${project.id}/prompt-drafts/${body.id}/commit`,
          headers: {
            ...ctx.auth,
            'if-match': `"${first.json<{ rowVersion: number }>().rowVersion}"`,
            'idempotency-key': 'commit-0007'
          },
          payload: {}
        })
      ).json<{ version: { id: string } }>().version.id
      const modify = await ctx.app.inject({
        method: 'PATCH',
        url: `/api/v1/art-projects/${project.id}/prompt-versions/${versionId}`,
        headers: ctx.auth,
        payload: { state: specWithAsset(assetId) }
      })
      expect(modify.statusCode).toBe(404)
    } finally {
      await ctx.close()
    }
  })

  it('materializes an inline brief and keeps its projection pinned in the draft', async () => {
    const ctx = await createTestApp()
    try {
      const { character, project } = await seedProject(ctx)
      const input = await postMetadataOnlyInput(ctx, project.id, {
        characterBrief: {
          schemaVersion: 'character-brief/1',
          identity: { fullName: '雾原铃' },
          appearance: { hair: '银灰色短发', outfit: '深蓝色工装外套' },
          personality: { traits: ['谨慎'] }
        },
        requirements: [],
        materials: []
      })
      expect(input.statusCode).toBe(201)
      const body = input.json<{
        submission: { id: string; revision: number; characterBriefVersionId: string | null }
        draft: {
          id: string
          rowVersion: number
          state: { blocks: Array<{ id: string; source: string; locked: boolean; text: string }> }
        }
      }>()
      expect(body.submission.characterBriefVersionId).toMatch(/^cbv_/)
      const projected = body.draft.state.blocks.filter((block) => block.source === 'character-brief')
      expect(projected.map((block) => block.id)).toEqual([
        'brief.identity',
        'brief.appearance.hair',
        'brief.appearance.outfit'
      ])
      expect(projected.every((block) => block.locked)).toBe(true)
      expect(JSON.stringify(projected)).not.toContain('谨慎')

      const briefs = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/characters/${character.id}/brief-versions`,
        headers: ctx.auth
      })
      expect(briefs.json<{ activeVersionId: string }>().activeVersionId).toBe(
        body.submission.characterBriefVersionId
      )

      const tampered = structuredClone(body.draft.state)
      tampered.blocks.find((block) => block.id === 'brief.appearance.hair')!.text = '黑色长发'
      const saved = await ctx.app.inject({
        method: 'PATCH',
        url: `/api/v1/art-projects/${project.id}/prompt-drafts/${body.draft.id}`,
        headers: { ...ctx.auth, 'if-match': `"${body.draft.rowVersion}"` },
        payload: { state: tampered }
      })
      expect(saved.statusCode).toBe(200)
      expect(
        saved
          .json<{ state: { blocks: Array<{ id: string; text: string }> } }>()
          .state.blocks.find((block) => block.id === 'brief.appearance.hair')?.text
      ).toContain('银灰色短发')

      const committed = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/art-projects/${project.id}/prompt-drafts/${body.draft.id}/commit`,
        headers: {
          ...ctx.auth,
          'if-match': `"${saved.json<{ rowVersion: number }>().rowVersion}"`,
          'idempotency-key': 'commit-brief-0001'
        },
        payload: { acknowledgeUncoveredRequirements: false }
      })
      expect(committed.statusCode).toBe(201)
      expect(
        committed.json<{ version: { state: { characterBriefVersionId?: string } } }>().version.state
          .characterBriefVersionId
      ).toBe(body.submission.characterBriefVersionId)
    } finally {
      await ctx.close()
    }
  })

  it('requires If-Match for draft writes and rejects repeated If-Match headers', async () => {
    const ctx = await createTestApp()
    try {
      const { project } = await seedProject(ctx)
      const input = await postInput(ctx, project.id)
      const body = input.json<{
        draft: { id: string; rowVersion: number }
        submission: { materials: Array<{ assetId: string }> }
      }>()
      const assetId = body.submission.materials[0]!.assetId

      const missingPatch = await ctx.app.inject({
        method: 'PATCH',
        url: `/api/v1/art-projects/${project.id}/prompt-drafts/${body.draft.id}`,
        headers: ctx.auth,
        payload: { state: specWithAsset(assetId) }
      })
      expect(missingPatch.statusCode).toBe(428)
      expect(missingPatch.json()).toMatchObject({ error: { code: 'PRECONDITION_REQUIRED' } })

      const missingCommit = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/art-projects/${project.id}/prompt-drafts/${body.draft.id}/commit`,
        headers: { ...ctx.auth, 'idempotency-key': 'commit-no-if-match' },
        payload: {}
      })
      expect(missingCommit.statusCode).toBe(428)
      expect(missingCommit.json()).toMatchObject({ error: { code: 'PRECONDITION_REQUIRED' } })

      const repeated = await ctx.app.inject({
        method: 'PATCH',
        url: `/api/v1/art-projects/${project.id}/prompt-drafts/${body.draft.id}`,
        headers: { ...ctx.auth, 'if-match': ['"1"', '"2"'] } as unknown as Record<string, string>,
        payload: { state: specWithAsset(assetId) }
      })
      expect(repeated.statusCode).toBe(400)
      expect(repeated.json()).toMatchObject({ error: { code: 'REQUEST_INVALID' } })
    } finally {
      await ctx.close()
    }
  })

  it('requires an active prompt version when creating from active_version', async () => {
    const ctx = await createTestApp()
    try {
      const { project } = await seedProject(ctx)
      const response = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/art-projects/${project.id}/prompt-drafts`,
        headers: { ...ctx.auth, 'idempotency-key': 'draft-ver-0001' },
        payload: { from: 'active_version' }
      })
      expect(response.statusCode).toBe(409)
      expect(response.json()).toMatchObject({ error: { code: 'PROMPT_VERSION_REQUIRED' } })
    } finally {
      await ctx.close()
    }
  })

  it('rejects ingest that drops assets or requirements referenced by the active version', async () => {
    const ctx = await createTestApp()
    try {
      const { project, asset } = await seedProject(ctx)
      const input = await postInput(ctx, project.id)
      const body = input.json<{
        draft: { id: string; rowVersion: number }
        submission: { materials: Array<{ assetId: string }> }
      }>()
      const assetId = body.submission.materials[0]!.assetId
      const saved = await ctx.app.inject({
        method: 'PATCH',
        url: `/api/v1/art-projects/${project.id}/prompt-drafts/${body.draft.id}`,
        headers: { ...ctx.auth, 'if-match': `"${body.draft.rowVersion}"` },
        payload: { state: specWithAsset(assetId) }
      })
      const committed = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/art-projects/${project.id}/prompt-drafts/${body.draft.id}/commit`,
        headers: {
          ...ctx.auth,
          'if-match': `"${saved.json<{ rowVersion: number }>().rowVersion}"`,
          'idempotency-key': 'commit-mismatch-0001'
        },
        payload: {}
      })
      expect(committed.statusCode).toBe(201)

      const mismatch = await postMetadataOnlyInput(ctx, project.id, {
        requirements: [],
        materials: [{ partName: 'seed', assetId: asset.id, role: 'style_reference', sortOrder: 0 }]
      })
      expect(mismatch.statusCode).toBe(409)
      expect(mismatch.json()).toMatchObject({ error: { code: 'PROMPT_INPUT_MISMATCH' } })
    } finally {
      await ctx.close()
    }
  })

  it('rejects a missing multipart file part for declared materials', async () => {
    const ctx = await createTestApp()
    try {
      const { project } = await seedProject(ctx)
      const response = await postMetadataOnlyInput(ctx, project.id, {
        requirements: [],
        materials: [{ partName: 'face', fileField: 'file_face', role: 'identity_reference', sortOrder: 0 }]
      })
      expect(response.statusCode).toBe(400)
      expect(response.json()).toMatchObject({ error: { code: 'REQUEST_INVALID' } })
    } finally {
      await ctx.close()
    }
  })

  it('rejects metadata sent as a file part', async () => {
    const ctx = await createTestApp()
    try {
      const { project } = await seedProject(ctx)
      const form = new FormData()
      form.append(
        'metadata',
        new Blob([JSON.stringify({ requirements: [], materials: [] })], {
          type: 'application/json'
        })
      )
      const { payload, contentType } = await multipartPayload(form)
      const response = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/art-projects/${project.id}/prompt-inputs`,
        headers: { ...ctx.auth, 'content-type': contentType },
        payload
      })
      expect(response.statusCode).toBe(400)
      expect(response.json()).toMatchObject({
        error: { code: 'REQUEST_INVALID', details: { reason: 'metadata must be a field' } }
      })
    } finally {
      await ctx.close()
    }
  })

  it('serves committed prompt versions and rejects unknown version ids', async () => {
    const ctx = await createTestApp()
    try {
      const { project } = await seedProject(ctx)
      const input = await postInput(ctx, project.id)
      const body = input.json<{
        draft: { id: string; rowVersion: number }
        submission: { materials: Array<{ assetId: string }> }
      }>()
      const assetId = body.submission.materials[0]!.assetId
      const saved = await ctx.app.inject({
        method: 'PATCH',
        url: `/api/v1/art-projects/${project.id}/prompt-drafts/${body.draft.id}`,
        headers: { ...ctx.auth, 'if-match': `"${body.draft.rowVersion}"` },
        payload: { state: specWithAsset(assetId) }
      })
      const commit = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/art-projects/${project.id}/prompt-drafts/${body.draft.id}/commit`,
        headers: {
          ...ctx.auth,
          'if-match': `"${saved.json<{ rowVersion: number }>().rowVersion}"`,
          'idempotency-key': 'commit-versions-0001'
        },
        payload: {}
      })
      expect(commit.statusCode).toBe(201)
      const version = commit.json<{ version: { id: string; versionNumber: number; contentHash: string } }>()
        .version

      const list = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/art-projects/${project.id}/prompt-versions`,
        headers: ctx.auth
      })
      expect(list.statusCode).toBe(200)
      expect(list.json<{ items: Array<{ id: string; versionNumber: number }> }>().items[0]).toMatchObject({
        id: version.id,
        versionNumber: 1
      })

      const detail = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/art-projects/${project.id}/prompt-versions/${version.id}`,
        headers: ctx.auth
      })
      expect(detail.statusCode).toBe(200)
      expect(detail.json()).toMatchObject({
        id: version.id,
        versionNumber: version.versionNumber,
        contentHash: version.contentHash
      })

      const unknown = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/art-projects/${project.id}/prompt-versions/pv_01J00000000000000000000000`,
        headers: ctx.auth
      })
      expect(unknown.statusCode).toBe(404)
      expect(unknown.json()).toMatchObject({ error: { code: 'RESOURCE_NOT_FOUND' } })
    } finally {
      await ctx.close()
    }
  })
})
