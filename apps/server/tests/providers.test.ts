import { describe, expect, it } from 'vitest'
import { SEEDREAM_CAPABILITIES, type ProviderCapabilities } from '@agent2live/contracts'
import { normalizeProviderBaseUrl } from '../src/services/provider-connections'
import { StaticSecretResolver } from '../src/services/secret-resolver'
import { createTestApp } from './helpers/app'

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

const ARK_CHAT_MODEL = {
  id: 'doubao-seed-1-6',
  name: 'Doubao Seed',
  kind: 'chat' as const,
  adapter: 'openai-compatible' as const,
  capabilities: {
    schemaVersion: 'provider-capabilities/1' as const,
    chat: { maxImages: 8, maxPromptChars: 20_000, supportsVision: true }
  }
}
const ARK_IMAGE_MODEL = {
  id: 'doubao-seedream-5-0-pro',
  name: 'Seedream',
  kind: 'image' as const,
  adapter: 'seedream' as const,
  capabilities: {
    schemaVersion: 'provider-capabilities/1' as const,
    image: {
      maxReferenceImages: 4,
      maxPromptChars: 20_000,
      supportsNegativePrompt: false,
      supportsWeightSyntax: false,
      supportsSeed: true,
      maxCount: 4,
      sizes: ['1024x1024']
    }
  }
}

describe('provider connections', () => {
  it('creates a mock connection idempotently, hides secret fields, and updates with CAS', async () => {
    const ctx = await createTestApp()
    try {
      const payload = {
        label: 'Mock Art',
        kind: 'image',
        adapter: 'mock',
        enabled: true,
        capabilities: IMAGE_CAPABILITIES
      }
      const headers = { ...ctx.auth, 'idempotency-key': 'provider-create-mock-0001' }
      const created = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/providers',
        headers,
        payload
      })
      expect(created.statusCode).toBe(201)
      const provider = created.json<{ id: string; rowVersion: number; hasSecret: boolean }>()
      expect(provider).toMatchObject({ hasSecret: false })
      expect(created.payload).not.toContain('secret_ref')
      expect(created.payload).not.toContain('secretRef')
      expect(
        ctx.db.prepare("select scope_kind, scope_id from event_log where type = 'provider.created'").get()
      ).toEqual({ scope_kind: 'system', scope_id: 'system' })

      const replay = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/providers',
        headers,
        payload
      })
      expect(replay.statusCode).toBe(201)
      expect(replay.json()).toEqual(provider)

      const list = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/providers',
        headers: ctx.auth
      })
      expect(list.json<{ items: unknown[] }>().items).toHaveLength(1)

      const updated = await ctx.app.inject({
        method: 'PATCH',
        url: `/api/v1/providers/${provider.id}`,
        headers: { ...ctx.auth, 'if-match': `"${provider.rowVersion}"` },
        payload: { label: 'Renamed' }
      })
      expect(updated.statusCode).toBe(200)
      expect(updated.json()).toMatchObject({
        label: 'Renamed',
        rowVersion: provider.rowVersion + 1
      })

      const stale = await ctx.app.inject({
        method: 'PATCH',
        url: `/api/v1/providers/${provider.id}`,
        headers: { ...ctx.auth, 'if-match': `"${provider.rowVersion}"` },
        payload: { label: 'Lost' }
      })
      expect(stale.statusCode).toBe(409)
      expect(stale.json()).toMatchObject({ error: { code: 'ROW_VERSION_CONFLICT' } })
    } finally {
      await ctx.close()
    }
  })

  it('enforces adapter profiles and only enables real providers with a resolvable secret', async () => {
    const ctx = await createTestApp({
      secrets: new StaticSecretResolver(new Map([['sec_01J00000000000000000000000', 'sk-test-value']]))
    })
    try {
      const seedreamAsChat = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/providers',
        headers: { ...ctx.auth, 'idempotency-key': 'provider-create-bad-seedream' },
        payload: {
          label: 'seedream',
          kind: 'chat',
          adapter: 'seedream',
          capabilities: CHAT_CAPABILITIES
        }
      })
      expect(seedreamAsChat.statusCode).toBe(400)
      expect(seedreamAsChat.json()).toMatchObject({ error: { code: 'REQUEST_INVALID' } })

      const enabledWithoutSecret = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/providers',
        headers: { ...ctx.auth, 'idempotency-key': 'provider-create-no-secret' },
        payload: {
          label: 'OpenAI',
          kind: 'chat',
          adapter: 'openai-compatible',
          baseUrl: 'https://api.example.com/v1',
          model: 'vision-model',
          enabled: true,
          capabilities: CHAT_CAPABILITIES
        }
      })
      expect(enabledWithoutSecret.statusCode).toBe(422)
      expect(enabledWithoutSecret.json()).toMatchObject({
        error: { code: 'PROVIDER_NOT_CONFIGURED' }
      })

      const disabled = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/providers',
        headers: { ...ctx.auth, 'idempotency-key': 'provider-create-disabled' },
        payload: {
          label: 'OpenAI',
          kind: 'chat',
          adapter: 'openai-compatible',
          baseUrl: 'https://api.example.com/v1',
          model: 'vision-model',
          enabled: false,
          capabilities: CHAT_CAPABILITIES
        }
      })
      expect(disabled.statusCode).toBe(201)
      const provider = disabled.json<{ id: string; rowVersion: number; hasSecret: boolean }>()
      expect(provider.hasSecret).toBe(false)

      const enabled = await ctx.app.inject({
        method: 'PATCH',
        url: `/api/v1/providers/${provider.id}`,
        headers: { ...ctx.auth, 'if-match': `"${provider.rowVersion}"` },
        payload: { secretRef: 'sec_01J00000000000000000000000', enabled: true }
      })
      expect(enabled.statusCode).toBe(200)
      expect(enabled.json()).toMatchObject({
        hasSecret: true,
        enabled: true,
        rowVersion: provider.rowVersion + 1
      })
      expect(enabled.payload).not.toContain('sec_01J00000000000000000000000')

      const badCapabilities = await ctx.app.inject({
        method: 'PATCH',
        url: `/api/v1/providers/${provider.id}`,
        headers: {
          ...ctx.auth,
          'if-match': `"${enabled.json<{ rowVersion: number }>().rowVersion}"`
        },
        payload: {
          capabilities: {
            schemaVersion: 'provider-capabilities/1',
            image: {
              maxReferenceImages: 1,
              maxPromptChars: 20000,
              supportsNegativePrompt: false,
              supportsWeightSyntax: false,
              supportsSeed: false,
              maxCount: 1,
              sizes: ['512x896']
            }
          }
        }
      })
      expect(badCapabilities.statusCode).toBe(400)
      expect(badCapabilities.json()).toMatchObject({ error: { code: 'REQUEST_INVALID' } })

      const unknownSecret = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/providers',
        headers: { ...ctx.auth, 'idempotency-key': 'provider-create-unknown-secret' },
        payload: {
          label: 'OpenAI',
          kind: 'chat',
          adapter: 'openai-compatible',
          baseUrl: 'https://api.example.com/v1',
          model: 'vision-model',
          enabled: true,
          secretRef: 'sec_01J00000000000000000000001',
          capabilities: CHAT_CAPABILITIES
        }
      })
      expect(unknownSecret.statusCode).toBe(422)
      expect(unknownSecret.json()).toMatchObject({ error: { code: 'PROVIDER_NOT_CONFIGURED' } })
    } finally {
      await ctx.close()
    }
  })

  it('resolves mock adapters and records invocation outcomes without payloads', async () => {
    const ctx = await createTestApp()
    try {
      const ids = { requestId: 'req_provider_registry', traceId: 'trc_provider_registry' }
      const imageConnection = ctx.services.providerConnections.create(
        {
          label: 'Mock Art',
          kind: 'image',
          adapter: 'mock',
          enabled: true,
          capabilities: IMAGE_CAPABILITIES
        },
        ids
      )
      const chatConnection = ctx.services.providerConnections.create(
        {
          label: 'Mock Chat',
          kind: 'chat',
          adapter: 'mock',
          enabled: true,
          capabilities: CHAT_CAPABILITIES
        },
        ids
      )
      const image = await ctx.services.providerRegistry.image(imageConnection.id)
      const generated = await image.generate(
        { prompt: 'a prompt', size: '512x896', count: 1 },
        { requestId: 'req_image' }
      )
      expect(generated.images).toHaveLength(1)
      const chat = await ctx.services.providerRegistry.chat(chatConnection.id)
      const completion = await chat.generate(
        { messages: [{ role: 'user', content: 'hi' }] },
        { requestId: 'req_chat' }
      )
      expect(JSON.parse(completion.text)).toMatchObject({ operations: expect.any(Array) })

      const invocations = ctx.services.providerInvocations
      const hash = 'a'.repeat(64)
      const succeeded = invocations.start({
        connectionId: imageConnection.id,
        purpose: 'image.generate',
        requestHash: hash,
        model: 'mock-art'
      })
      invocations.succeed(succeeded, { latencyMs: 12, outputUnits: 1 })
      const failed = invocations.start({
        connectionId: chatConnection.id,
        purpose: 'prompt.reverse',
        requestHash: hash,
        model: 'mock-art'
      })
      invocations.fail(failed, 'PROVIDER_TIMEOUT', 30, {
        status: 504,
        providerCode: 'Timeout'
      })
      const cancelled = invocations.start({
        connectionId: chatConnection.id,
        purpose: 'prompt.suggestion',
        requestHash: hash,
        model: 'mock-art'
      })
      invocations.cancel(cancelled, 5)
      const rows = ctx.db
        .prepare(
          `select status, latency_ms, input_units, output_units, error_code, error_detail_json
           from provider_invocations order by id`
        )
        .all()
      expect(rows).toEqual(
        expect.arrayContaining([
          {
            status: 'succeeded',
            latency_ms: 12,
            input_units: null,
            output_units: 1,
            error_code: null,
            error_detail_json: null
          },
          {
            status: 'failed',
            latency_ms: 30,
            input_units: null,
            output_units: null,
            error_code: 'PROVIDER_TIMEOUT',
            error_detail_json: '{"status":504,"providerCode":"Timeout"}'
          },
          {
            status: 'cancelled',
            latency_ms: 5,
            input_units: null,
            output_units: null,
            error_code: null,
            error_detail_json: null
          }
        ])
      )
      expect(JSON.stringify(rows)).not.toContain('a prompt')
    } finally {
      await ctx.close()
    }
  })

  it('probes a provider without requiring an idempotency key and returns only safe metadata', async () => {
    const ctx = await createTestApp()
    try {
      const created = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/providers',
        headers: { ...ctx.auth, 'idempotency-key': 'provider-probe-chat' },
        payload: {
          label: 'Mock Chat',
          kind: 'chat',
          adapter: 'mock',
          enabled: true,
          capabilities: CHAT_CAPABILITIES
        }
      })
      expect(created.statusCode).toBe(201)
      const provider = created.json<{ id: string; rowVersion: number; enabled: boolean }>()

      const probe = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/providers/${provider.id}/test`,
        headers: ctx.auth,
        payload: {}
      })
      expect(probe.statusCode).toBe(200)
      expect(probe.json()).toMatchObject({
        ok: true,
        kind: 'chat',
        adapter: 'mock',
        model: 'mock-art',
        billable: false
      })
      expect(probe.payload).not.toMatch(/apiKey|secretRef|responseText/)

      const unknown = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/providers/conn_01J00000000000000000000000/test',
        headers: ctx.auth,
        payload: {}
      })
      expect(unknown.statusCode).toBe(404)
      expect(unknown.json()).toMatchObject({ error: { code: 'RESOURCE_NOT_FOUND' } })

      const extra = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/providers/${provider.id}/test`,
        headers: ctx.auth,
        payload: { apiKey: 'sk-should-not-be-accepted' }
      })
      expect(extra.statusCode).toBe(400)
      expect(extra.json()).toMatchObject({ error: { code: 'REQUEST_INVALID' } })

      const disabled = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/providers',
        headers: { ...ctx.auth, 'idempotency-key': 'provider-probe-disabled' },
        payload: {
          label: 'Disabled Chat',
          kind: 'chat',
          adapter: 'mock',
          enabled: false,
          capabilities: CHAT_CAPABILITIES
        }
      })
      expect(disabled.statusCode).toBe(201)
      const disabledProbe = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/providers/${disabled.json<{ id: string }>().id}/test`,
        headers: ctx.auth,
        payload: {}
      })
      expect(disabledProbe.statusCode).toBe(422)
      expect(disabledProbe.json()).toMatchObject({
        error: { code: 'PROVIDER_NOT_CONFIGURED' }
      })
    } finally {
      await ctx.close()
    }
  })

  it('stores a multi-model catalog on a fixed Ark connection and resolves selections', async () => {
    const ctx = await createTestApp({
      secrets: new StaticSecretResolver(new Map([['sec_01J00000000000000000000000', 'sk-test-value']]))
    })
    try {
      const created = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/providers',
        headers: { ...ctx.auth, 'idempotency-key': 'provider-ark-catalog-0001' },
        payload: {
          label: '火山方舟',
          kind: 'chat',
          adapter: 'openai-compatible',
          model: ARK_CHAT_MODEL.id,
          capabilities: ARK_CHAT_MODEL.capabilities,
          presetId: 'volcengine-ark',
          models: [ARK_CHAT_MODEL, ARK_IMAGE_MODEL],
          secretRef: 'sec_01J00000000000000000000000',
          enabled: true
        }
      })
      expect(created.statusCode).toBe(201)
      const provider = created.json<{
        id: string
        baseUrl: string
        models: Array<{ id: string; kind: string }>
        modelsRefreshedAt: string | null
        rowVersion: number
      }>()
      expect(provider.baseUrl).toBe('https://ark.cn-beijing.volces.com/api/v3')
      expect(provider.models).toHaveLength(2)
      expect(provider.modelsRefreshedAt).toBe(new Date(ctx.clock.now()).toISOString())
      expect(ctx.services.providerConnections.get(provider.id).modelsRefreshedAt).toBe(ctx.clock.now())

      const chat = ctx.services.providerConnections.resolveModel(provider.id, 'chat')
      expect(chat).toMatchObject({ modelId: 'doubao-seed-1-6', adapter: 'openai-compatible' })
      const image = ctx.services.providerConnections.resolveModel(
        provider.id,
        'image',
        'doubao-seedream-5-0-pro'
      )
      expect(image).toMatchObject({ modelId: 'doubao-seedream-5-0-pro', adapter: 'seedream' })
      expect(() =>
        ctx.services.providerConnections.resolveModel(provider.id, 'image', 'missing-model')
      ).toThrow(expect.objectContaining({ code: 'PROVIDER_MODEL_NOT_AVAILABLE' }))
    } finally {
      await ctx.close()
    }
  })

  it('falls back to the legacy single model when config_json is empty', async () => {
    const ctx = await createTestApp({
      secrets: new StaticSecretResolver(new Map([['sec_01J00000000000000000000000', 'sk-test-value']]))
    })
    try {
      const created = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/providers',
        headers: { ...ctx.auth, 'idempotency-key': 'provider-legacy-model-0001' },
        payload: {
          label: 'Legacy',
          kind: 'chat',
          adapter: 'openai-compatible',
          baseUrl: 'https://api.example.com/v1',
          model: 'legacy-model',
          capabilities: CHAT_CAPABILITIES,
          secretRef: 'sec_01J00000000000000000000000',
          enabled: true
        }
      })
      const provider = created.json<{ id: string; models: Array<{ id: string; kind: string }> }>()
      expect(provider.models).toEqual([
        expect.objectContaining({ id: 'legacy-model', kind: 'chat', adapter: 'openai-compatible' })
      ])
      const selection = ctx.services.providerConnections.resolveModel(provider.id, 'chat')
      expect(selection.modelId).toBe('legacy-model')
    } finally {
      await ctx.close()
    }
  })

  it('normalizes seedream endpoint URLs to the API root they are built from', () => {
    expect(
      normalizeProviderBaseUrl('seedream', 'https://ark.cn-beijing.volces.com/api/v3/images/generations')
    ).toBe('https://ark.cn-beijing.volces.com/api/v3')
    expect(
      normalizeProviderBaseUrl('seedream', 'https://ark.cn-beijing.volces.com/api/v3/images/generations/')
    ).toBe('https://ark.cn-beijing.volces.com/api/v3')
    expect(
      normalizeProviderBaseUrl(
        'seedream',
        'https://ark.cn-beijing.volces.com/api/v3/images/generations/images/generations'
      )
    ).toBe('https://ark.cn-beijing.volces.com/api/v3')
    expect(normalizeProviderBaseUrl('seedream', 'https://ark.cn-beijing.volces.com/api/v3')).toBe(
      'https://ark.cn-beijing.volces.com/api/v3'
    )
    expect(
      normalizeProviderBaseUrl('openai-compatible', 'https://api.example.com/v1/images/generations')
    ).toBe('https://api.example.com/v1/images/generations')
    expect(normalizeProviderBaseUrl('seedream', null)).toBeNull()
    expect(normalizeProviderBaseUrl('seedream', undefined)).toBeUndefined()
  })

  it('rejects a seedream base URL that embeds the image endpoint mid-path', () => {
    expect(() =>
      normalizeProviderBaseUrl('seedream', 'https://proxy.example.com/api/v3/images/generations/extra')
    ).toThrow(expect.objectContaining({ code: 'REQUEST_INVALID' }))
  })

  it('stores a normalized seedream base URL on create and update', async () => {
    const ctx = await createTestApp({
      secrets: new StaticSecretResolver(new Map([['sec_01J00000000000000000000000', 'sk-test-value']]))
    })
    try {
      const created = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/providers',
        headers: { ...ctx.auth, 'idempotency-key': 'provider-create-seedream-endpoint' },
        payload: {
          label: 'Seedream',
          kind: 'image',
          adapter: 'seedream',
          baseUrl: 'https://ark.cn-beijing.volces.com/api/v3/images/generations',
          model: 'doubao-seedream-5-0-pro-260628',
          secretRef: 'sec_01J00000000000000000000000',
          capabilities: SEEDREAM_CAPABILITIES
        }
      })
      expect(created.statusCode).toBe(201)
      expect(created.json()).toMatchObject({
        baseUrl: 'https://ark.cn-beijing.volces.com/api/v3'
      })
      const provider = created.json<{ id: string; rowVersion: number }>()

      const rejected = await ctx.app.inject({
        method: 'PATCH',
        url: `/api/v1/providers/${provider.id}`,
        headers: { ...ctx.auth, 'if-match': `"${provider.rowVersion}"` },
        payload: { baseUrl: 'https://ark.cn-beijing.volces.com/api/v3/images/generations/extra' }
      })
      expect(rejected.statusCode).toBe(400)
      expect(rejected.json()).toMatchObject({ error: { code: 'REQUEST_INVALID' } })

      const updated = await ctx.app.inject({
        method: 'PATCH',
        url: `/api/v1/providers/${provider.id}`,
        headers: { ...ctx.auth, 'if-match': `"${provider.rowVersion}"` },
        payload: { baseUrl: 'https://ark.cn-beijing.volces.com/api/v3/images/generations/' }
      })
      expect(updated.statusCode).toBe(200)
      expect(updated.json()).toMatchObject({
        baseUrl: 'https://ark.cn-beijing.volces.com/api/v3'
      })
      expect(
        ctx.db.prepare('select base_url from provider_connections where id = ?').get(provider.id)
      ).toEqual({ base_url: 'https://ark.cn-beijing.volces.com/api/v3' })
    } finally {
      await ctx.close()
    }
  })
})
