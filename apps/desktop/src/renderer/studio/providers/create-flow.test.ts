import { describe, expect, it, vi } from 'vitest'
import type { ProviderModelProfile } from '@studio/api'
import {
  ProviderConnectionActivationError,
  ProviderConnectionFormError,
  buildCreateConnectionInput,
  createProviderConnectionFlow,
  editConnectionCatalogPatch,
  updateProviderConnectionFlow,
  type ProviderConnectionFlowPort
} from './create-flow'
import type { ProviderConnectionFormValues } from './presets'

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

function values(overrides: Partial<ProviderConnectionFormValues> = {}): ProviderConnectionFormValues {
  return {
    presetId: 'volcengine-ark',
    label: '火山方舟',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    kind: 'chat',
    adapter: 'openai-compatible',
    defaultModelId: '',
    customModelId: '',
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

function port(overrides: Partial<ProviderConnectionFlowPort> = {}): ProviderConnectionFlowPort {
  return {
    create: vi.fn(async () => connection({ enabled: false, hasSecret: false })),
    update: vi.fn(async (_id, patch, rowVersion) => connection({ ...patch, rowVersion: rowVersion + 1 })),
    get: vi.fn(async () => connection()),
    storeSecret: vi.fn(async () => ({ secretRef: 'sec_01J00000000000000000000002' })),
    deleteSecret: vi.fn(async () => undefined),
    ...overrides
  } as ProviderConnectionFlowPort
}

describe('provider create flow', () => {
  it('builds a fixed preset create input from the catalog', () => {
    const input = buildCreateConnectionInput(values(), [CHAT_MODEL, IMAGE_MODEL])
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

  it('uses built-in models for fixed providers and allows manual custom models', () => {
    const fixed = buildCreateConnectionInput(values(), [])
    expect(fixed).toMatchObject({
      presetId: 'volcengine-ark',
      kind: 'chat',
      adapter: 'openai-compatible',
      model: 'doubao-seed-2-1-pro-260915'
    })
    expect(fixed.models).toHaveLength(9)
    const custom = buildCreateConnectionInput(
      values({
        presetId: 'custom',
        label: '自定义',
        baseUrl: 'https://example.com/v1',
        customModelId: 'my-image-model',
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

  it('rejects a default model whose kind differs from the edit connection', async () => {
    const current = connection({
      kind: 'chat',
      adapter: 'openai-compatible',
      model: 'chat-a',
      models: [CHAT_MODEL, IMAGE_MODEL]
    })
    await expect(
      updateProviderConnectionFlow(port(), current, values({ defaultModelId: 'image-a', apiKey: '' }))
    ).rejects.toMatchObject({ fields: { model: '所选模型类型与连接类型不一致。' } })
  })

  it('stores the key, activates, and deletes the draft secret', async () => {
    const p = port()
    const result = await createProviderConnectionFlow(p, values(), [CHAT_MODEL, IMAGE_MODEL], 'sec_draft')
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

  it('recovers when activation succeeded but the response was lost', async () => {
    const created = connection({ enabled: false, hasSecret: false })
    const active = connection({ rowVersion: 2 })
    const p = port({
      create: vi.fn(async () => created),
      update: vi.fn(async () => {
        throw new Error('network reset')
      }),
      get: vi.fn(async () => active)
    })
    await expect(createProviderConnectionFlow(p, values(), [CHAT_MODEL, IMAGE_MODEL], null)).resolves.toEqual(
      active
    )
    expect(p.deleteSecret).not.toHaveBeenCalled()
  })

  it('reports a partial failure with the connection id instead of retrying blindly', async () => {
    const created = connection({ enabled: false, hasSecret: false })
    const p = port({
      create: vi.fn(async () => created),
      update: vi.fn(async () => {
        throw new Error('invalid secret reference')
      }),
      get: vi.fn(async () => created)
    })
    await expect(
      createProviderConnectionFlow(p, values(), [CHAT_MODEL, IMAGE_MODEL], null)
    ).rejects.toBeInstanceOf(ProviderConnectionActivationError)
    await expect(
      createProviderConnectionFlow(p, values(), [CHAT_MODEL, IMAGE_MODEL], null)
    ).rejects.toMatchObject({
      name: 'ProviderConnectionActivationError',
      connectionId: created.id
    })
  })

  it('never patches baseUrl for a fixed provider on update', async () => {
    const current = connection()
    const p = port({ update: vi.fn(async () => connection({ rowVersion: 2 })) })
    await updateProviderConnectionFlow(p, current, values({ label: '改名', apiKey: '' }), {})
    expect(p.update).toHaveBeenCalledWith(current.id, { label: '改名' }, current.rowVersion)
  })

  it('keeps the existing secret when the update leaves the key blank', async () => {
    const current = connection()
    const p = port({ update: vi.fn(async () => connection({ label: '改名', rowVersion: 2 })) })
    await updateProviderConnectionFlow(p, current, values({ label: '改名', apiKey: '' }), {})
    expect(p.storeSecret).not.toHaveBeenCalled()
    expect(p.update).toHaveBeenCalledWith(current.id, { label: '改名' }, current.rowVersion)
  })

  it('rotates a typed key under the stable label and deletes the draft secret', async () => {
    const current = connection({ rowVersion: 3 })
    const p = port({ update: vi.fn(async () => connection({ rowVersion: 4 })) })
    await updateProviderConnectionFlow(p, current, values({ apiKey: 'sk-rotated' }), {
      draftSecretRef: 'sec_draft'
    })
    expect(p.storeSecret).toHaveBeenCalledWith({
      label: `provider-secret:${current.id}`,
      value: 'sk-rotated'
    })
    expect(p.update).toHaveBeenCalledWith(current.id, { secretRef: 'sec_01J00000000000000000000002' }, 3)
    expect(p.deleteSecret).toHaveBeenCalledWith('sec_draft')
  })
})

function customConnection(overrides: Record<string, unknown> = {}) {
  return connection({ label: '自定义', baseUrl: 'https://old.example.com/v1', ...overrides })
}

function customValues(overrides: Partial<ProviderConnectionFormValues> = {}): ProviderConnectionFormValues {
  return values({
    presetId: 'custom',
    label: '自定义',
    baseUrl: 'https://new.example.com/v1',
    apiKey: '',
    ...overrides
  })
}

describe('provider custom endpoint edit', () => {
  it('keeps the saved catalog when only the key is rotated', () => {
    const current = customConnection()
    expect(
      editConnectionCatalogPatch(
        customValues({ baseUrl: 'https://old.example.com/v1', apiKey: 'sk-rotated' }),
        current,
        null
      )
    ).toBeUndefined()
  })

  it('requires fresh models or a manual profile after a custom URL change', async () => {
    const current = customConnection()
    const changed = customValues()
    expect(editConnectionCatalogPatch(changed, current, null)).toBeUndefined()
    const p = port()
    await expect(updateProviderConnectionFlow(p, current, changed, {})).rejects.toMatchObject({
      fields: { model: expect.any(String) }
    })
    expect(p.update).not.toHaveBeenCalled()
  })

  it('replaces the old catalog with freshly fetched models after a URL change', async () => {
    const current = customConnection()
    const changed = customValues()
    const fresh: ProviderModelProfile = { ...CHAT_MODEL, id: 'new-model' }
    const models = editConnectionCatalogPatch(changed, current, [fresh])
    expect(models).toEqual([fresh])
    // 重新拉取到相同目录时也视为新目录，不再沿用旧端点的缓存。
    expect(editConnectionCatalogPatch(changed, current, [...current.models])).toEqual(current.models)

    const p = port({ update: vi.fn(async () => connection({ rowVersion: 2 })) })
    await updateProviderConnectionFlow(p, current, changed, { models: models! })
    expect(p.update).toHaveBeenCalledWith(
      current.id,
      expect.objectContaining({ baseUrl: 'https://new.example.com/v1', models: [fresh] }),
      current.rowVersion
    )
  })

  it('sends the manual model profile instead of the old catalog after a URL change', async () => {
    const current = customConnection()
    const changed = customValues({ customModelId: 'manual-model' })
    const models = editConnectionCatalogPatch(changed, current, null)
    expect(models).toEqual([expect.objectContaining({ id: 'manual-model', kind: 'chat' })])
    const p = port()
    await updateProviderConnectionFlow(p, current, changed, { models: models! })
    expect(p.update).toHaveBeenCalledWith(
      current.id,
      expect.objectContaining({ baseUrl: 'https://new.example.com/v1', models }),
      current.rowVersion
    )
  })
})
