import { describe, expect, it, vi } from 'vitest'
import type { ChatProvider } from '@agent2live/providers'
import { createTestApp } from './helpers/app'
import { postMetadataOnlyInput, seedProject } from './helpers/seed-prompt'
import { specFixture } from './fixtures/spec'

type Ctx = Awaited<ReturnType<typeof createTestApp>>

function syncSpec() {
  const spec = specFixture()
  spec.fullPrompt = '用户写好的完整角色提示词。'
  spec.materialRefs = []
  for (const block of [...spec.blocks, ...spec.negativeBlocks]) {
    block.evidence = []
    block.materialRefs = []
  }
  return spec
}

async function prepareDraft(ctx: Ctx) {
  const { project } = await seedProject(ctx)
  const state = syncSpec()
  const input = await postMetadataOnlyInput(ctx, project.id, {
    characterBrief: {
      schemaVersion: 'character-brief/1',
      identity: { fullName: '银发少女' },
      appearance: { hair: '银白长发' }
    },
    globalNotes: state.fullPrompt,
    requirements: state.sourceRequirements,
    materials: []
  })
  expect(input.statusCode).toBe(201)
  const draft = input.json<{ draft: { id: string; rowVersion: number } }>().draft
  const saved = await ctx.app.inject({
    method: 'PATCH',
    url: `/api/v1/art-projects/${project.id}/prompt-drafts/${draft.id}`,
    headers: { ...ctx.auth, 'if-match': `"${draft.rowVersion}"` },
    payload: { state }
  })
  expect(saved.statusCode).toBe(200)
  const savedDraft = saved.json<{
    id: string
    rowVersion: number
    state: ReturnType<typeof syncSpec>
  }>()
  return {
    project,
    state: savedDraft.state,
    draft: { id: savedDraft.id, rowVersion: savedDraft.rowVersion }
  }
}

let providerCreateSeq = 0
function nextProviderKey(prefix: string): string {
  providerCreateSeq += 1
  return `${prefix}-${String(providerCreateSeq).padStart(4, '0')}`
}

async function createChat(ctx: Ctx) {
  const response = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/providers',
    headers: { ...ctx.auth, 'idempotency-key': 'prompt-sync-provider-0001' },
    payload: {
      label: 'Prompt Sync Mock',
      kind: 'chat',
      adapter: 'mock',
      enabled: true,
      capabilities: {
        schemaVersion: 'provider-capabilities/1',
        chat: { maxImages: 8, maxPromptChars: 20_000, supportsVision: false }
      }
    }
  })
  return response.json<{ id: string }>()
}

async function createMultiModelChat(ctx: Ctx) {
  const response = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/providers',
    headers: { ...ctx.auth, 'idempotency-key': nextProviderKey('provider-chat-multi') },
    payload: {
      label: 'Prompt Sync Multi',
      kind: 'chat',
      adapter: 'mock',
      capabilities: {
        schemaVersion: 'provider-capabilities/1',
        chat: { maxImages: 0, maxPromptChars: 20_000, supportsVision: false }
      },
      models: [
        {
          id: 'sync-chat-a',
          name: null,
          kind: 'chat',
          adapter: 'mock',
          capabilities: {
            schemaVersion: 'provider-capabilities/1',
            chat: { maxImages: 0, maxPromptChars: 20_000, supportsVision: false }
          }
        },
        {
          id: 'sync-chat-b',
          name: null,
          kind: 'chat',
          adapter: 'mock',
          capabilities: {
            schemaVersion: 'provider-capabilities/1',
            chat: { maxImages: 0, maxPromptChars: 20_000, supportsVision: false }
          }
        }
      ]
    }
  })
  expect(response.statusCode).toBe(201)
  return response.json<{ id: string }>()
}

function providerReturning(output: unknown): ChatProvider {
  return {
    kind: 'chat',
    generate: vi.fn(async (_request, context) => ({
      text: JSON.stringify(output),
      model: 'prompt-sync-mock',
      providerRequestId: context.requestId,
      usage: { inputTokens: 1, outputTokens: 1 }
    }))
  }
}

async function enqueue(
  ctx: Ctx,
  prepared: Awaited<ReturnType<typeof prepareDraft>>,
  providerId: string,
  source: 'full' | 'blocks'
) {
  return ctx.app.inject({
    method: 'POST',
    url: `/api/v1/art-projects/${prepared.project.id}/prompt-drafts/${prepared.draft.id}/sync`,
    headers: {
      ...ctx.auth,
      'if-match': `"${prepared.draft.rowVersion}"`,
      'idempotency-key': `prompt-sync-${source}-0001`
    },
    payload: {
      providerConnectionId: providerId,
      source,
      state: prepared.state
    }
  })
}

async function completedResult(ctx: Ctx, jobId: string) {
  await ctx.services.jobs.tick()
  const response = await ctx.app.inject({
    method: 'GET',
    url: `/api/v1/jobs/${jobId}`,
    headers: ctx.auth
  })
  const body = response.json<{
    status: string
    errorCode: string | null
    result: {
      state: { fullPrompt: string; blocks: Array<{ id: string; text: string }> }
      conflicts: unknown[]
      warnings: string[]
    }
  }>()
  return body
}

describe('prompt sync API', () => {
  it('synchronizes a full prompt into unlocked granular blocks', async () => {
    const ctx = await createTestApp()
    try {
      const prepared = await prepareDraft(ctx)
      const provider = await createChat(ctx)
      const styleBefore = prepared.state.blocks.find((block) => block.id === 'style.rendering')!.text
      vi.spyOn(ctx.services.providerRegistry, 'chat').mockResolvedValue(
        providerReturning({
          fullPrompt: 'AI 不应覆盖用户全文。',
          operations: [
            {
              op: 'replace',
              blockId: 'style.rendering',
              before: styleBefore,
              after: '干净的厚涂插画'
            }
          ],
          warnings: []
        })
      )

      const response = await enqueue(ctx, prepared, provider.id, 'full')
      expect(response.statusCode).toBe(202)
      const result = await completedResult(ctx, response.json<{ jobId: string }>().jobId)
      expect(result.status).toBe('succeeded')
      expect(result.result.state.fullPrompt).toBe(prepared.state.fullPrompt)
      expect(result.result.state.blocks.find((block) => block.id === 'style.rendering')?.text).toBe(
        '干净的厚涂插画'
      )
    } finally {
      await ctx.close()
    }
  })

  it('synchronizes blocks into a coherent full prompt and ignores model operations', async () => {
    const ctx = await createTestApp()
    try {
      const prepared = await prepareDraft(ctx)
      const provider = await createChat(ctx)
      vi.spyOn(ctx.services.providerRegistry, 'chat').mockResolvedValue(
        providerReturning({
          fullPrompt: '由颗粒块重新写成的连贯完整提示词。',
          operations: [
            {
              op: 'replace',
              blockId: 'style.rendering',
              before: '清爽的日系赛璐璐插画，干净线稿',
              after: '不应生效'
            }
          ],
          warnings: []
        })
      )

      const response = await enqueue(ctx, prepared, provider.id, 'blocks')
      const result = await completedResult(ctx, response.json<{ jobId: string }>().jobId)
      expect(result.status).toBe('succeeded')
      expect(result.result.state.fullPrompt).toBe('由颗粒块重新写成的连贯完整提示词。')
      expect(result.result.state.blocks).toEqual(prepared.state.blocks)
      expect(result.result.warnings).toContain('operations_ignored_for_blocks_source')
    } finally {
      await ctx.close()
    }
  })

  it('rejects a stale draft row version before enqueueing', async () => {
    const ctx = await createTestApp()
    try {
      const prepared = await prepareDraft(ctx)
      const provider = await createChat(ctx)
      const response = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/art-projects/${prepared.project.id}/prompt-drafts/${prepared.draft.id}/sync`,
        headers: {
          ...ctx.auth,
          'if-match': `"${prepared.draft.rowVersion + 1}"`,
          'idempotency-key': 'prompt-sync-stale-0001'
        },
        payload: {
          providerConnectionId: provider.id,
          source: 'full',
          state: prepared.state
        }
      })
      expect(response.statusCode).toBe(409)
      expect(response.json<{ error: { code: string } }>().error.code).toBe('ROW_VERSION_CONFLICT')
    } finally {
      await ctx.close()
    }
  })

  it('records the requested chat model in the job payload and invocation', async () => {
    const ctx = await createTestApp()
    try {
      const prepared = await prepareDraft(ctx)
      const connection = await createMultiModelChat(ctx)
      vi.spyOn(ctx.services.providerRegistry, 'chat').mockResolvedValue(
        providerReturning({
          fullPrompt: '同步后的完整提示词',
          operations: [],
          conflicts: [],
          warnings: []
        })
      )
      const created = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/art-projects/${prepared.project.id}/prompt-drafts/${prepared.draft.id}/sync`,
        headers: {
          ...ctx.auth,
          'if-match': `"${prepared.draft.rowVersion}"`,
          'idempotency-key': 'prompt-sync-model-0001'
        },
        payload: {
          providerConnectionId: connection.id,
          modelId: 'sync-chat-b',
          source: 'full',
          state: prepared.state
        }
      })
      expect(created.statusCode).toBe(202)
      const jobId = created.json<{ jobId: string }>().jobId
      const job = ctx.db.prepare('select payload_json from jobs where id = ?').get(jobId) as {
        payload_json: string
      }
      expect(JSON.parse(job.payload_json)).toMatchObject({
        model: { providerConnectionId: connection.id, modelId: 'sync-chat-b', adapter: 'mock' }
      })
      await ctx.services.jobs.tick()
      expect(
        ctx.db.prepare('select model from provider_invocations order by started_at desc limit 1').get()
      ).toEqual({ model: 'sync-chat-b' })
    } finally {
      await ctx.close()
    }
  })
})
