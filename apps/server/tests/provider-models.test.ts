import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { createTestApp } from './helpers/app'
import { ProviderModelsService } from '../src/services/provider-models'
import { StaticSecretResolver } from '../src/services/secret-resolver'

const SECRET_REF = 'sec_01J00000000000000000000000'
const CHAT_CAPABILITIES = {
  schemaVersion: 'provider-capabilities/1' as const,
  chat: { maxImages: 8, maxPromptChars: 20_000, supportsVision: true }
}

let server: ReturnType<typeof createServer> | null = null
afterEach(async () => {
  await new Promise<void>((resolve) => {
    if (!server) return resolve()
    server.close(() => resolve())
  })
  server = null
})

async function startModelsServer(handler: (res: import('node:http').ServerResponse) => void) {
  server = createServer((_req, res) => handler(res))
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
  const address = server.address() as AddressInfo
  return `http://127.0.0.1:${address.port}/v1`
}

function sendJson(res: import('node:http').ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

const MODELS_BODY = {
  data: [
    {
      id: 'deepseek-flash',
      name: 'DeepSeek Flash',
      output_modalities: ['text'],
      input_modalities: ['text', 'image']
    }
  ]
}

describe('provider models service', () => {
  it('previews a fixed preset using the catalog URL and flavor', async () => {
    const calls: unknown[] = []
    const service = new ProviderModelsService({
      connections: {} as never,
      secrets: new StaticSecretResolver(new Map([[SECRET_REF, 'sk-test']])),
      discover: async (input) => {
        calls.push(input)
        return [
          {
            id: 'deepseek-flash',
            name: 'DeepSeek Flash',
            kind: 'chat',
            adapter: 'openai-compatible',
            capabilities: CHAT_CAPABILITIES
          }
        ]
      }
    })

    const result = await service.preview(
      { target: 'preset', presetId: 'deepseek-chat', secretRef: SECRET_REF },
      'req-models'
    )
    expect(calls[0]).toMatchObject({
      baseUrl: 'https://api.deepseek.com/v1',
      flavor: 'deepseek',
      requestId: 'req-models'
    })
    expect(result.items).toHaveLength(1)
    expect(JSON.stringify(result)).not.toContain('sk-test')
    expect(JSON.stringify(result)).not.toContain(SECRET_REF)
  })

  it('maps provider failures without leaking the secret', async () => {
    const service = new ProviderModelsService({
      connections: {} as never,
      secrets: new StaticSecretResolver(new Map([[SECRET_REF, 'sk-test']])),
      discover: async () => {
        const { ProviderError } = await import('@agent2live/providers')
        throw new ProviderError('PROVIDER_MODELS_UNSUPPORTED', 'no models')
      }
    })
    await expect(
      service.preview(
        {
          target: 'custom',
          kind: 'chat',
          adapter: 'openai-compatible',
          baseUrl: 'https://example.com/v1',
          secretRef: SECRET_REF
        },
        'req-fail'
      )
    ).rejects.toMatchObject({ code: 'PROVIDER_MODELS_UNSUPPORTED' })
  })

  it('refreshes a connection with the saved key and updates config_json under If-Match', async () => {
    const baseUrl = await startModelsServer((res) => sendJson(res, 200, MODELS_BODY))
    const ctx = await createTestApp({
      secrets: new StaticSecretResolver(new Map([[SECRET_REF, 'sk-test']]))
    })
    try {
      const created = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/providers',
        headers: { ...ctx.auth, 'idempotency-key': 'provider-refresh-0001' },
        payload: {
          label: 'Custom chat',
          kind: 'chat',
          adapter: 'openai-compatible',
          baseUrl,
          model: 'legacy-model',
          secretRef: SECRET_REF,
          enabled: true,
          capabilities: CHAT_CAPABILITIES
        }
      })
      const provider = created.json<{ id: string; rowVersion: number }>()
      const refreshed = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/providers/${provider.id}/models/refresh`,
        headers: { ...ctx.auth, 'if-match': `"${provider.rowVersion}"` }
      })
      expect(refreshed.statusCode).toBe(200)
      expect(refreshed.json()).toMatchObject({
        models: [expect.objectContaining({ id: 'deepseek-flash', kind: 'chat' })],
        modelsRefreshedAt: new Date(ctx.clock.now()).toISOString(),
        rowVersion: provider.rowVersion + 1
      })
      expect(refreshed.payload).not.toContain('sk-test')
      expect(refreshed.payload).not.toContain(SECRET_REF)
    } finally {
      await ctx.close()
    }
  })

  it('does not overwrite the previous catalog when refresh fails', async () => {
    const baseUrl = await startModelsServer((res) => sendJson(res, 500, { error: { code: 'boom' } }))
    const ctx = await createTestApp({
      secrets: new StaticSecretResolver(new Map([[SECRET_REF, 'sk-test']]))
    })
    try {
      const created = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/providers',
        headers: { ...ctx.auth, 'idempotency-key': 'provider-refresh-fail-0001' },
        payload: {
          label: 'Custom chat',
          kind: 'chat',
          adapter: 'openai-compatible',
          baseUrl,
          model: 'legacy-model',
          secretRef: SECRET_REF,
          enabled: true,
          capabilities: CHAT_CAPABILITIES
        }
      })
      const provider = created.json<{ id: string; rowVersion: number; models: unknown[] }>()
      const failed = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/providers/${provider.id}/models/refresh`,
        headers: { ...ctx.auth, 'if-match': `"${provider.rowVersion}"` }
      })
      expect(failed.statusCode).toBe(503)
      const after = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/providers/${provider.id}`,
        headers: ctx.auth
      })
      expect(after.json()).toMatchObject({
        rowVersion: provider.rowVersion,
        models: [expect.objectContaining({ id: 'legacy-model' })]
      })
    } finally {
      await ctx.close()
    }
  })

  it('stores an explicit empty catalog when discovery succeeds with no models', async () => {
    const baseUrl = await startModelsServer((res) => sendJson(res, 200, { data: [] }))
    const ctx = await createTestApp({
      secrets: new StaticSecretResolver(new Map([[SECRET_REF, 'sk-test']]))
    })
    try {
      const created = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/providers',
        headers: { ...ctx.auth, 'idempotency-key': 'provider-refresh-empty-0001' },
        payload: {
          label: 'Custom chat',
          kind: 'chat',
          adapter: 'openai-compatible',
          baseUrl,
          model: 'legacy-model',
          secretRef: SECRET_REF,
          enabled: true,
          capabilities: CHAT_CAPABILITIES
        }
      })
      const provider = created.json<{ id: string; rowVersion: number }>()
      const refreshed = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/providers/${provider.id}/models/refresh`,
        headers: { ...ctx.auth, 'if-match': `"${provider.rowVersion}"` }
      })
      expect(refreshed.statusCode).toBe(200)
      expect(refreshed.json()).toMatchObject({
        models: [],
        modelsRefreshedAt: new Date(ctx.clock.now()).toISOString(),
        rowVersion: provider.rowVersion + 1
      })
      expect(ctx.services.providerConnections.get(provider.id).models).toEqual([])
    } finally {
      await ctx.close()
    }
  })

  it('rejects a refresh without If-Match', async () => {
    const ctx = await createTestApp({
      secrets: new StaticSecretResolver(new Map([[SECRET_REF, 'sk-test']]))
    })
    try {
      const created = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/providers',
        headers: { ...ctx.auth, 'idempotency-key': 'provider-refresh-precondition-0001' },
        payload: {
          label: 'Custom chat',
          kind: 'chat',
          adapter: 'openai-compatible',
          baseUrl: 'https://example.com/v1',
          model: 'legacy-model',
          secretRef: SECRET_REF,
          enabled: true,
          capabilities: CHAT_CAPABILITIES
        }
      })
      const provider = created.json<{ id: string }>()
      const response = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/providers/${provider.id}/models/refresh`,
        headers: ctx.auth
      })
      expect(response.statusCode).toBe(428)
    } finally {
      await ctx.close()
    }
  })
})
