import { expect } from 'vitest'
import type { TestApp } from './app'
import { multipartPayload, seedProject, specWithAsset } from './seed-prompt'
import { png } from './files'

export async function committedPrompt(ctx: TestApp, suffix = '0001') {
  const { character, project, asset } = await seedProject(ctx)
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
    headers: {
      ...ctx.auth,
      'if-match': `"${draft.rowVersion}"`,
      'idempotency-key': `backup-commit-${suffix}`
    },
    payload: {}
  })
  expect(commit.statusCode).toBe(201)
  return {
    character,
    project,
    asset,
    inputSubmission: input.submission,
    promptVersion: commit.json<{ version: { id: string; contentHash: string } }>().version
  }
}
