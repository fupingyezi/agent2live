import { describe, expect, it, vi } from 'vitest'
import {
  ProviderError,
  type ChatProvider,
  type ChatRequest,
  type ImageProvider,
  type ImageRequest
} from '@agent2live/providers'
import type { ProviderCapabilities } from '@agent2live/contracts'
import { createTestApp } from './helpers/app'
import { ProviderProbeService } from '../src/services/provider-probes'
import type { ProviderConnectionRow } from '../src/services/provider-connections'

const IMAGE_CAPABILITIES = {
  schemaVersion: 'provider-capabilities/1',
  image: {
    maxReferenceImages: 4,
    maxPromptChars: 20000,
    supportsNegativePrompt: true,
    supportsWeightSyntax: true,
    supportsSeed: true,
    maxCount: 4,
    sizes: ['512x896', '1024x1792']
  }
} satisfies ProviderCapabilities

const CHAT_CAPABILITIES = {
  schemaVersion: 'provider-capabilities/1',
  chat: { maxImages: 8, maxPromptChars: 20000, supportsVision: true }
} satisfies ProviderCapabilities

function connectionRow(
  kind: 'chat' | 'image',
  adapter: 'mock' | 'openai-compatible' | 'seedream'
): ProviderConnectionRow {
  return {
    id: `conn_${kind}`,
    label: kind,
    kind,
    adapter,
    base_url: adapter === 'mock' ? null : 'https://api.example.com/v1',
    model: adapter === 'mock' ? null : `${adapter}-model`,
    secret_ref: adapter === 'mock' ? null : 'sec_01J00000000000000000000000',
    config_json: '{}',
    capabilities_json: JSON.stringify(kind === 'chat' ? CHAT_CAPABILITIES : IMAGE_CAPABILITIES),
    enabled: 1,
    created_at: 1,
    updated_at: 1,
    row_version: 1
  }
}

function chatServiceFixture() {
  const generate = vi.fn(async (_request: ChatRequest) => ({
    text: 'OK',
    model: 'chat-model',
    providerRequestId: 'req-chat',
    usage: { inputTokens: 3, outputTokens: 1 }
  }))
  const provider: ChatProvider = { kind: 'chat', generate }
  const row = connectionRow('chat', 'mock')
  const service = new ProviderProbeService({
    connections: { getRow: () => row },
    registry: {
      chat: async () => provider,
      image: async () => {
        throw new Error('unused image provider')
      }
    },
    clock: { now: () => 1_763_000_000_000 }
  })
  return { service, generate }
}

function imageServiceFixture() {
  const generate = vi.fn(async (_request: ImageRequest) => ({
    images: [
      {
        data: Buffer.from('discard-me'),
        mimeType: 'image/png' as const,
        sha256: 'a'.repeat(64),
        width: 1,
        height: 1
      }
    ],
    model: 'image-model',
    providerRequestId: 'req-image'
  }))
  const provider: ImageProvider = { kind: 'image', generate }
  const row = connectionRow('image', 'mock')
  const service = new ProviderProbeService({
    connections: { getRow: () => row },
    registry: {
      chat: async () => {
        throw new Error('unused chat provider')
      },
      image: async () => provider
    },
    clock: { now: () => 1_763_000_000_000 }
  })
  return { service, generate }
}

describe('provider probe service', () => {
  it('uses a minimal chat probe and returns no secret fields', async () => {
    const { service, generate } = chatServiceFixture()
    const result = await service.probe('conn_chat', { allowBillableRequest: false }, 'req_probe')

    expect(generate).toHaveBeenCalledWith(
      {
        messages: [{ role: 'user', content: 'Reply with OK.' }],
        maxTokens: 8
      },
      { requestId: 'req_probe' }
    )
    expect(result).toEqual({
      ok: true,
      kind: 'chat',
      adapter: 'mock',
      model: 'chat-model',
      latencyMs: expect.any(Number),
      checkedAt: 1_763_000_000_000,
      billable: false
    })
    expect(JSON.stringify(result)).not.toMatch(/secret|apiKey|responseText/)
  })

  it('requires explicit billing confirmation before probing an image provider', async () => {
    const { service, generate } = imageServiceFixture()

    await expect(
      service.probe('conn_image', { allowBillableRequest: false }, 'req_probe')
    ).rejects.toMatchObject({ code: 'PROVIDER_BILLABLE_CONFIRMATION_REQUIRED' })
    expect(generate).not.toHaveBeenCalled()
  })

  it('requests and discards exactly one image after billing confirmation', async () => {
    const { service, generate } = imageServiceFixture()
    const result = await service.probe('conn_image', { allowBillableRequest: true }, 'req_probe')

    expect(generate).toHaveBeenCalledTimes(1)
    expect(generate.mock.calls[0]?.[0]).toMatchObject({
      prompt: 'A single small neutral color square.',
      size: '512x896',
      count: 1
    })
    expect(result).toMatchObject({
      ok: true,
      kind: 'image',
      adapter: 'mock',
      model: 'image-model',
      billable: true
    })
    expect(JSON.stringify(result)).not.toContain('discard-me')
  })

  it.each([
    ['PROVIDER_AUTH_FAILED', 'upstream body sk-secret'],
    ['PROVIDER_RATE_LIMITED', 'upstream body sk-secret'],
    ['PROVIDER_TIMEOUT', 'upstream body sk-secret'],
    ['PROVIDER_INVALID_RESPONSE', 'upstream body sk-secret']
  ] as const)('normalizes %s without leaking provider text', async (code, message) => {
    const row = connectionRow('chat', 'openai-compatible')
    const service = new ProviderProbeService({
      connections: { getRow: () => row },
      registry: {
        chat: async () => ({
          kind: 'chat',
          generate: async () => {
            throw new ProviderError(code, message)
          }
        }),
        image: async () => {
          throw new Error('unused')
        }
      },
      clock: { now: () => 1_763_000_000_000 }
    })

    try {
      await service.probe(row.id, { allowBillableRequest: false }, 'req_probe')
      throw new Error('expected probe to fail')
    } catch (error) {
      expect(error).toMatchObject({ code, message: code })
      expect(String(error)).not.toMatch(/sk-secret|upstream body/)
    }
  })

  it('does not persist probe jobs, art versions, or invocations', async () => {
    const ctx = await createTestApp()
    try {
      const ids = { requestId: 'req_probe_persist', traceId: 'trc_probe_persist' }
      const chat = ctx.services.providerConnections.create(
        {
          label: 'Probe Chat',
          kind: 'chat',
          adapter: 'mock',
          enabled: true,
          capabilities: CHAT_CAPABILITIES
        },
        ids
      )
      const image = ctx.services.providerConnections.create(
        {
          label: 'Probe Image',
          kind: 'image',
          adapter: 'mock',
          enabled: true,
          capabilities: IMAGE_CAPABILITIES
        },
        ids
      )
      const before = {
        jobs: ctx.db.prepare('select count(*) as count from generation_jobs').get(),
        arts: ctx.db.prepare('select count(*) as count from art_versions').get(),
        invocations: ctx.db.prepare('select count(*) as count from provider_invocations').get()
      }

      await ctx.services.providerProbes.probe(chat.id, { allowBillableRequest: false }, 'req_probe_chat')
      await ctx.services.providerProbes.probe(image.id, { allowBillableRequest: true }, 'req_probe_image')

      expect({
        jobs: ctx.db.prepare('select count(*) as count from generation_jobs').get(),
        arts: ctx.db.prepare('select count(*) as count from art_versions').get(),
        invocations: ctx.db.prepare('select count(*) as count from provider_invocations').get()
      }).toEqual(before)
    } finally {
      await ctx.close()
    }
  })
})
