import type { TestApp } from './app'
import { png } from './files'
import { specFixture } from '../fixtures/spec'

export async function seedProject(ctx: TestApp) {
  const character = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/characters',
    headers: ctx.auth,
    payload: { title: '银发少女', summary: '测试角色' }
  })
  const characterBody = character.json<{ id: string }>()
  const project = await ctx.app.inject({
    method: 'POST',
    url: `/api/v1/characters/${characterBody.id}/art-projects`,
    headers: ctx.auth,
    payload: { title: '主项目' }
  })
  const asset = await ctx.services.assets.ingestUpload({
    bytes: await png(320, 480),
    declaredMime: 'image/png',
    originalName: 'identity.png',
    requestId: 'seed',
    traceId: 'seed'
  })
  return {
    character: characterBody,
    project: project.json<{ id: string; rowVersion: number }>(),
    asset: asset.asset
  }
}

export function specWithAsset(assetId: string): Record<string, unknown> {
  const spec = structuredClone(specFixture()) as {
    materialRefs: Array<{ assetId: string }>
    blocks: Array<{ evidence: Array<{ assetId: string }>; materialRefs: string[] }>
  }
  spec.materialRefs[0]!.assetId = assetId
  spec.blocks[0]!.evidence[0]!.assetId = assetId
  spec.blocks[0]!.materialRefs = [assetId]
  return spec as Record<string, unknown>
}

export async function multipartPayload(form: FormData): Promise<{ payload: Buffer; contentType: string }> {
  const response = new Response(form)
  const payload = Buffer.from(await response.arrayBuffer())
  return { payload, contentType: response.headers.get('content-type')! }
}

export async function postMetadataOnlyInput(
  ctx: TestApp,
  projectId: string,
  metadata: Record<string, unknown>,
  headers: Record<string, string> = {}
) {
  const form = new FormData()
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }))
  const { payload, contentType } = await multipartPayload(form)
  return ctx.app.inject({
    method: 'POST',
    url: `/api/v1/art-projects/${projectId}/prompt-inputs`,
    headers: { ...ctx.auth, 'content-type': contentType, ...headers },
    payload
  })
}
