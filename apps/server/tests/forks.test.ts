import { describe, expect, it } from 'vitest'
import { createTestApp } from './helpers/app'
import { multipartPayload, postMetadataOnlyInput, seedProject, specWithAsset } from './helpers/seed-prompt'
import { png } from './helpers/files'

type Ctx = Awaited<ReturnType<typeof createTestApp>>
type ReferenceView = {
  assetId: string
  role: string
  note: string
  weight: number
  sortOrder: number
  isPrimary: boolean
  locked: boolean
}

function referenceTuples(references: ReferenceView[]) {
  return references.map((reference) => [
    reference.assetId,
    reference.role,
    reference.note,
    reference.weight,
    reference.sortOrder,
    reference.isPrimary,
    reference.locked
  ])
}

async function committedPrompt(ctx: Ctx, key = 'fork-commit-0001') {
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
  form.append('file_face', new Blob([new Uint8Array(await png(320, 480))], { type: 'image/png' }), 'face.png')
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
    headers: { ...ctx.auth, 'if-match': `"${draft.rowVersion}"`, 'idempotency-key': key },
    payload: {}
  })
  expect(commit.statusCode).toBe(201)
  return {
    project,
    asset,
    promptVersion: commit.json<{ version: { id: string } }>().version,
    projectAfter: commit.json<{ project: { rowVersion: number } }>().project
  }
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
    characterId: string
    rowVersion: number
    stage: string
    activeVersionId: string | null
    activePromptVersionId: string | null
    forkedFrom: {
      forkId: string
      parentProjectId: string
      rootProjectId: string
      sourceKind: string
      sourceVersionId: string
      branchLabel: string
      status: string
      parentDeleted: boolean
    } | null
  }>()
}

describe('project forks', () => {
  it('forks a committed prompt version into an independent child project', async () => {
    const ctx = await createTestApp()
    try {
      const { project, promptVersion } = await committedPrompt(ctx)
      const response = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/prompt-versions/${promptVersion.id}/forks`,
        headers: { ...ctx.auth, 'idempotency-key': 'fork-prompt-0001' },
        payload: { title: '蓝发冬季服', branchLabel: '蓝发冬季服', description: '从 v1 分支' }
      })
      expect(response.statusCode).toBe(201)
      const body = response.json<{
        fork: {
          id: string
          childProjectId: string
          parentProjectId: string
          rootProjectId: string
          sourceKind: string
          sourceVersionId: string
          sourceHash: string
          branchLabel: string
          status: string
        }
        childProject: {
          id: string
          characterId: string
          stage: string
          activeVersionId: string | null
          activePromptVersionId: string
        }
        seedPromptVersion: {
          id: string
          artProjectId: string
          versionNumber: number
          parentVersionId: string | null
          inputSubmissionId: string
          contentHash: string
        }
        seedArtVersion: null
      }>()
      expect(body.fork).toMatchObject({
        childProjectId: body.childProject.id,
        parentProjectId: project.id,
        rootProjectId: project.id,
        sourceKind: 'prompt_version',
        sourceVersionId: promptVersion.id,
        branchLabel: '蓝发冬季服',
        status: 'active'
      })
      expect(body.fork.sourceHash).toHaveLength(64)
      expect(body.childProject).toMatchObject({
        characterId: expect.any(String),
        stage: 'prompt_ready',
        activeVersionId: null,
        activePromptVersionId: body.seedPromptVersion.id
      })
      expect(body.seedPromptVersion).toMatchObject({
        artProjectId: body.childProject.id,
        versionNumber: 1,
        parentVersionId: null
      })
      expect(body.seedPromptVersion.id).not.toBe(promptVersion.id)
      expect(body.seedPromptVersion.inputSubmissionId).not.toBe('')

      const parentAfter = await currentProject(ctx, project.id)
      expect(parentAfter.activePromptVersionId).toBe(promptVersion.id)
      const child = await currentProject(ctx, body.childProject.id)
      expect(child.forkedFrom).toMatchObject({
        parentProjectId: project.id,
        sourceKind: 'prompt_version',
        sourceVersionId: promptVersion.id,
        status: 'active',
        parentDeleted: false
      })

      const replay = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/prompt-versions/${promptVersion.id}/forks`,
        headers: { ...ctx.auth, 'idempotency-key': 'fork-prompt-0001' },
        payload: { title: '蓝发冬季服', branchLabel: '蓝发冬季服', description: '从 v1 分支' }
      })
      expect(replay.statusCode).toBe(201)
      expect(replay.json<{ fork: { id: string } }>().fork.id).toBe(body.fork.id)

      const conflicting = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/prompt-versions/${promptVersion.id}/forks`,
        headers: { ...ctx.auth, 'idempotency-key': 'fork-prompt-0002' },
        payload: { title: '重复分支', branchLabel: '蓝发冬季服' }
      })
      expect(conflicting.statusCode).toBe(409)
      expect(conflicting.json()).toMatchObject({
        error: {
          code: 'FORK_BRANCH_CONFLICT',
          details: { parentProjectId: project.id, branchLabel: '蓝发冬季服' }
        }
      })
    } finally {
      await ctx.close()
    }
  })

  it('forks an art version sharing the blob, and keeps the root across nested forks', async () => {
    const ctx = await createTestApp()
    try {
      const { project, promptVersion } = await committedPrompt(ctx, 'fork-commit-0002')
      const manualAsset = (
        await ctx.services.assets.ingestUpload({
          bytes: await png(480, 720),
          declaredMime: 'image/png',
          originalName: 'fork-base.png',
          requestId: 'fork-seed',
          traceId: 'fork-seed'
        })
      ).asset
      const auxAsset = (
        await ctx.services.assets.ingestUpload({
          bytes: await png(320, 480),
          declaredMime: 'image/png',
          originalName: 'fork-aux.png',
          requestId: 'fork-seed-aux',
          traceId: 'fork-seed-aux'
        })
      ).asset
      const current = await currentProject(ctx, project.id)
      const art = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/art-projects/${project.id}/art-versions/manual`,
        headers: {
          ...ctx.auth,
          'if-match': `"${current.rowVersion}"`,
          'idempotency-key': 'fork-manual-0001'
        },
        payload: { assetId: manualAsset.id }
      })
      expect(art.statusCode).toBe(201)
      const manual = art.json<{
        artVersion: { id: string; references: ReferenceView[]; contentHash: string }
        project: { rowVersion: number }
      }>()
      const revised = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/art-versions/${manual.artVersion.id}/reference-revisions`,
        headers: {
          ...ctx.auth,
          'if-match': `"${manual.project.rowVersion}"`,
          'idempotency-key': 'fork-ref-0001'
        },
        payload: {
          reason: 'add',
          references: [
            {
              assetId: manualAsset.id,
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
              note: '服装',
              weight: 1.2,
              sortOrder: 1,
              isPrimary: false,
              locked: true
            }
          ]
        }
      })
      expect(revised.statusCode).toBe(201)
      const sourceArt = revised.json<{
        artVersion: { id: string; references: ReferenceView[]; contentHash: string }
      }>().artVersion

      const forked = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/art-versions/${sourceArt.id}/forks`,
        headers: { ...ctx.auth, 'idempotency-key': 'fork-art-0001' },
        payload: { title: '短发实验', branchLabel: '短发实验' }
      })
      expect(forked.statusCode).toBe(201)
      const forkedBody = forked.json<{
        fork: {
          id: string
          childProjectId: string
          parentProjectId: string
          rootProjectId: string
          sourceHash: string
        }
        childProject: { id: string; stage: string; activeVersionId: string; activePromptVersionId: string }
        seedPromptVersion: { id: string; contentHash: string }
        seedArtVersion: {
          id: string
          artProjectId: string
          versionNumber: number
          parentVersionId: string | null
          references: ReferenceView[]
          contentHash: string
        }
      }>()
      expect(forkedBody.fork).toMatchObject({
        parentProjectId: project.id,
        rootProjectId: project.id
      })
      expect(forkedBody.childProject).toMatchObject({
        stage: 'art_version_active',
        activeVersionId: forkedBody.seedArtVersion.id,
        activePromptVersionId: forkedBody.seedPromptVersion.id
      })
      expect(forkedBody.seedArtVersion).toMatchObject({
        versionNumber: 1,
        parentVersionId: null
      })
      expect(referenceTuples(forkedBody.seedArtVersion.references)).toEqual(
        referenceTuples(sourceArt.references)
      )
      expect(forkedBody.seedArtVersion.contentHash).toHaveLength(64)
      expect(forkedBody.seedArtVersion.artProjectId).toBe(forkedBody.childProject.id)
      expect(forkedBody.fork.sourceHash).toBe(sourceArt.contentHash)

      const nested = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/prompt-versions/${forkedBody.seedPromptVersion.id}/forks`,
        headers: { ...ctx.auth, 'idempotency-key': 'fork-nested-0001' },
        payload: { title: '冬季服短发版', branchLabel: '冬季服短发版' }
      })
      expect(nested.statusCode).toBe(201)
      const nestedBody = nested.json<{
        fork: { childProjectId: string; rootProjectId: string }
      }>()
      expect(nestedBody.fork.rootProjectId).toBe(project.id)

      const characterId = (await currentProject(ctx, project.id)).characterId
      const tree = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/art-projects/tree?characterId=${characterId}`,
        headers: ctx.auth
      })
      expect(tree.statusCode).toBe(200)
      const treeBody = tree.json<{
        roots: Array<{
          project: { id: string }
          fork: { branchLabel: string } | null
          parentDeleted: boolean
          children: Array<{
            project: { id: string }
            fork: { branchLabel: string; sourceKind: string } | null
            children: Array<{
              project: { id: string }
              fork: { branchLabel: string } | null
            }>
          }>
        }>
      }>()
      const root = treeBody.roots.find((node) => node.project.id === project.id)
      expect(root).toBeDefined()
      expect(root!.fork).toBeNull()
      const childNode = root!.children.find((node) => node.project.id === forkedBody.childProject.id)
      expect(childNode).toMatchObject({
        fork: { branchLabel: '短发实验', sourceKind: 'art_version' }
      })
      expect(childNode!.children.map((node) => node.project.id)).toContain(nestedBody.fork.childProjectId)
    } finally {
      await ctx.close()
    }
  })

  it('keeps children after parent deletion and detaches the lineage without losing provenance', async () => {
    const ctx = await createTestApp()
    try {
      const { project, promptVersion } = await committedPrompt(ctx, 'fork-commit-0003')
      const forkResponse = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/prompt-versions/${promptVersion.id}/forks`,
        headers: { ...ctx.auth, 'idempotency-key': 'fork-detach-0001' },
        payload: { title: '可脱离分支', branchLabel: 'v1-1' }
      })
      expect(forkResponse.statusCode).toBe(201)
      const childId = forkResponse.json<{ childProject: { id: string } }>().childProject.id
      const parentBefore = await currentProject(ctx, project.id)

      const deleted = await ctx.app.inject({
        method: 'DELETE',
        url: `/api/v1/art-projects/${project.id}`,
        headers: { ...ctx.auth, 'if-match': `"${parentBefore.rowVersion}"` }
      })
      expect(deleted.statusCode).toBe(204)

      const childAfterDelete = await currentProject(ctx, childId)
      expect(childAfterDelete.forkedFrom).toMatchObject({
        parentDeleted: true,
        status: 'active',
        sourceVersionId: promptVersion.id
      })

      const characterId = childAfterDelete.characterId
      const beforeDetach = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/art-projects/tree?characterId=${characterId}`,
        headers: ctx.auth
      })
      expect(beforeDetach.statusCode).toBe(200)
      const beforeRoot = beforeDetach
        .json<{
          roots: Array<{
            project: { id: string; deletedAt: number | null }
            children: Array<{ project: { id: string }; parentDeleted: boolean }>
          }>
        }>()
        .roots.find((node) => node.project.id === project.id)
      expect(beforeRoot).toBeDefined()
      expect(beforeRoot!.project.deletedAt).not.toBeNull()
      expect(beforeRoot!.children[0]).toMatchObject({ project: { id: childId }, parentDeleted: true })

      const renamed = await ctx.app.inject({
        method: 'PATCH',
        url: `/api/v1/art-projects/${childId}/fork-link`,
        headers: { ...ctx.auth, 'idempotency-key': 'fork-detach-0002' },
        payload: { branchLabel: '独立线', detach: true }
      })
      expect(renamed.statusCode).toBe(200)
      const renamedBody = renamed.json<{
        fork: {
          status: string
          branchLabel: string
          parentProjectId: string
          sourceVersionId: string
          detachedAt: number | null
        }
        childProject: { id: string; activePromptVersionId: string }
      }>()
      expect(renamedBody.fork).toMatchObject({
        status: 'detached',
        branchLabel: '独立线',
        parentProjectId: project.id,
        sourceVersionId: promptVersion.id
      })
      expect(renamedBody.fork.detachedAt).toEqual(expect.any(Number))
      expect(renamedBody.childProject.activePromptVersionId).toBeTruthy()

      const afterDetach = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/art-projects/tree?characterId=${characterId}`,
        headers: ctx.auth
      })
      const roots = afterDetach.json<{
        roots: Array<{ project: { id: string }; fork: { status: string } | null }>
      }>().roots
      expect(roots.some((node) => node.project.id === childId && node.fork?.status === 'detached')).toBe(true)
      expect(roots.some((node) => node.project.id === project.id)).toBe(false)

      const childAfterDetach = await currentProject(ctx, childId)
      expect(childAfterDetach.forkedFrom).toMatchObject({
        status: 'detached',
        parentDeleted: true,
        branchLabel: '独立线'
      })
    } finally {
      await ctx.close()
    }
  })

  it('pins the fork seed submission to the parent brief version and inherits its projection', async () => {
    const ctx = await createTestApp()
    try {
      const character = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/characters',
        headers: ctx.auth,
        payload: { title: '雾原铃', summary: '机械师' }
      })
      const characterId = character.json<{ id: string }>().id
      const brief = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/characters/${characterId}/brief-versions`,
        headers: ctx.auth,
        payload: {
          content: {
            schemaVersion: 'character-brief/1',
            identity: { fullName: '雾原铃', age: '19', gender: '女性', species: '人类' },
            appearance: { hair: '银灰色层次短发', eyes: '碧绿色眼睛', outfit: '深蓝色工装外套' }
          }
        }
      })
      expect(brief.statusCode).toBe(201)
      const briefVersionId = brief.json<{ id: string }>().id
      const project = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/characters/${characterId}/art-projects`,
        headers: ctx.auth,
        payload: { title: '主项目' }
      })
      const projectId = project.json<{ id: string }>().id

      const input = await postMetadataOnlyInput(ctx, projectId, {
        characterBriefVersionId: briefVersionId,
        globalNotes: '清透',
        requirements: [{ id: 'req_identity', text: '雾原铃的银灰短发', strength: 'must' }]
      })
      expect(input.statusCode).toBe(201)
      const inputBody = input.json<{ draft: { id: string; rowVersion: number } }>()
      const state = {
        schemaVersion: 'prompt-spec/2',
        lockAll: false,
        sourceRequirements: [{ id: 'req_identity', text: '雾原铃的银灰短发', strength: 'must' }],
        materialRefs: [],
        blocks: [
          {
            id: 'subject.identity',
            category: 'subject',
            label: '人物身份',
            text: '银灰短发的机械师少女',
            weight: 1,
            locked: true,
            confidence: 0.9,
            evidence: [],
            source: 'user',
            priority: 100,
            requirementRefs: ['req_identity'],
            materialRefs: []
          }
        ],
        negativeBlocks: [],
        constraints: { canvas: { width: 1024, height: 1792 }, background: 'transparent', aspect: 'portrait' }
      }
      const saved = await ctx.app.inject({
        method: 'PATCH',
        url: `/api/v1/art-projects/${projectId}/prompt-drafts/${inputBody.draft.id}`,
        headers: { ...ctx.auth, 'if-match': `"${inputBody.draft.rowVersion}"` },
        payload: { state }
      })
      expect(saved.statusCode).toBe(200)
      const commit = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/art-projects/${projectId}/prompt-drafts/${inputBody.draft.id}/commit`,
        headers: {
          ...ctx.auth,
          'if-match': `"${saved.json<{ rowVersion: number }>().rowVersion}"`,
          'idempotency-key': 'fork-brief-commit-0001'
        },
        payload: {}
      })
      expect(commit.statusCode).toBe(201)
      const parentVersion = commit.json<{ version: { id: string } }>().version

      const forked = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/prompt-versions/${parentVersion.id}/forks`,
        headers: { ...ctx.auth, 'idempotency-key': 'fork-brief-0001' },
        payload: { title: '子项目', branchLabel: 'v1-1' }
      })
      expect(forked.statusCode).toBe(201)
      const forkedBody = forked.json<{
        childProject: { id: string }
        seedPromptVersion: {
          id: string
          inputSubmissionId: string
          characterBriefVersionId: string | null
        }
      }>()
      expect(forkedBody.seedPromptVersion.characterBriefVersionId).toBe(briefVersionId)
      const seedSubmission = ctx.db
        .prepare('select character_brief_version_id from prompt_input_submissions where id = ?')
        .get(forkedBody.seedPromptVersion.inputSubmissionId) as { character_brief_version_id: string | null }
      expect(seedSubmission.character_brief_version_id).toBe(briefVersionId)

      const draft = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/art-projects/${forkedBody.childProject.id}/prompt-drafts`,
        headers: { ...ctx.auth, 'idempotency-key': 'fork-brief-draft-0001' },
        payload: { from: 'active_version' }
      })
      expect(draft.statusCode).toBe(201)
      const draftBody = draft.json<{
        state: { blocks: Array<{ source: string }>; characterBriefVersionId: string | null }
      }>()
      expect(draftBody.state.characterBriefVersionId).toBe(briefVersionId)
      expect(draftBody.state.blocks.some((block) => block.source === 'character-brief')).toBe(true)
    } finally {
      await ctx.close()
    }
  })
})
