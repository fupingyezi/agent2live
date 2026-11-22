import { describe, expect, it, vi } from 'vitest'
import type { ProviderModelProfile } from '@studio/api'
import {
  ProviderFormError,
  buildCreateInput,
  createProviderFlow,
  updateProviderFlow,
  type ProviderFlowPort
} from './create-flow'
import type { ProviderFormValues } from './presets'

const CHAT_MODEL: ProviderModelProfile = {
  id: 'chat-a',
  name: null,
  kind: 'chat',
  adapter: 'openai-compatible',
  capabilities: {
    schemaVersion: 'provider-capabilities/1',
    chat: { maxImages: 0, maxPromptChars: 20_000, supportsVision: false }
  }
}
const IMAGE_MODEL: ProviderModelProfile = {
  id: 'image-a',
  name: null,
  kind: 'image',
  adapter: 'seedream',
  capabilities: {
    schemaVersion: 'provider-capabilities/1',
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

function values(overrides: Partial<ProviderFormValues> = {}): ProviderFormValues {
  return {
    presetId: 'volcengine-ark',
    label: '火山方舟',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    kind: 'chat',
    adapter: 'openai-compatible',
    manualModel: '',
    apiKey: 'sk-test',
    enabled: true,
    ...overrides
  }
}

function connection(overrides: Record<string, unknown> = {}) {
  return {
    id: 'conn_01J0000000000000000000000',
    label: '火山方舟',
    kind: 'chat' as const,
    adapter: 'openai-compatible' as const,
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    model: 'chat-a',
    enabled: true,
    capabilities: CHAT_MODEL.capabilities,
    models: [CHAT_MODEL, IMAGE_MODEL],
    modelsRefreshedAt: '2026-11-23T00:00:00.000Z',
    hasSecret: true,
    createdAt: '2026-11-23T00:00:00.000Z',
    updatedAt: '2026-11-23T00:00:00.000Z',
    rowVersion: 1,
    ...overrides
  }
}

function port(overrides: Partial<ProviderFlowPort> = {}): ProviderFlowPort {
  return {
    create: vi.fn(async () => connection({ enabled: false, hasSecret: false })),
    update: vi.fn(async (_id, patch, rowVersion) => connection({ ...patch, rowVersion: rowVersion + 1 })),
    get: vi.fn(async () => connection()),
    storeSecret: vi.fn(async () => ({ secretRef: 'sec_01J00000000000000000000002' })),
    deleteSecret: vi.fn(async () => undefined),
    ...overrides
  } as ProviderFlowPort
}

describe('provider create flow', () => {
  it('builds a fixed preset create input from the catalog', () => {
    const input = buildCreateInput(values(), [CHAT_MODEL, IMAGE_MODEL])
    expect(input).toMatchObject({
      label: '火山方舟',
      kind: 'chat',
      adapter: 'openai-compatible',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
      model: 'chat-a',
      presetId: 'volcengine-ark',
      models: [CHAT_MODEL, IMAGE_MODEL],
      enabled: false
    })
    expect(JSON.stringify(input)).not.toContain('sk-test')
  })

  it('requires a model catalog for fixed providers and allows manual custom models', () => {
    expect(() => buildCreateInput(values(), [])).toThrow(ProviderFormError)
    const custom = buildCreateInput(
      values({
        presetId: 'custom',
        label: '自定义',
        baseUrl: 'https://example.com/v1',
        manualModel: 'my-image-model',
        kind: 'image',
        adapter: 'seedream'
      }),
      []
    )
    expect(custom).toMatchObject({
      presetId: 'custom',
      kind: 'image',
      adapter: 'seedream',
      baseUrl: 'https://example.com/v1',
      models: [expect.objectContaining({ id: 'my-image-model', kind: 'image' })]
    })
  })

  it('stores the key, activates, and deletes the draft secret', async () => {
    const p = port()
    const result = await createProviderFlow(p, values(), [CHAT_MODEL, IMAGE_MODEL], 'sec_draft')
    expect(p.create).toHaveBeenCalledWith(expect.objectContaining({ presetId: 'volcengine-ark' }))
    expect(p.storeSecret).toHaveBeenCalledWith({
      label: 'provider-secret:conn_01J0000000000000000000000',
      value: 'sk-test'
    })
    expect(p.update).toHaveBeenCalledWith(
      'conn_01J0000000000000000000000',
      { secretRef: 'sec_01J00000000000000000000002', enabled: true },
      1
    )
    expect(p.deleteSecret).toHaveBeenCalledWith('sec_draft')
    expect(result.enabled).toBe(true)
  })

  it('never patches baseUrl for a fixed provider on update', async () => {
    const current = connection()
    const p = port({ update: vi.fn(async () => connection({ rowVersion: 2 })) })
    await updateProviderFlow(p, current, values({ label: '改名' }), {})
    expect(p.update).toHaveBeenCalledWith(current.id, { label: '改名' }, current.rowVersion)
  })
})
