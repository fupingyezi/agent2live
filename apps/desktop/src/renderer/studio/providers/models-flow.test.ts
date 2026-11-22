import { describe, expect, it, vi } from 'vitest'
import type { ProviderModelProfile } from '@studio/api'
import { ProviderFormError } from './create-flow'
import { previewModelsForForm, type ProviderModelsPort } from './models-flow'
import type { ProviderFormValues } from './presets'

const MODEL: ProviderModelProfile = {
  id: 'model-a',
  name: null,
  kind: 'chat',
  adapter: 'openai-compatible',
  capabilities: {
    schemaVersion: 'provider-capabilities/1',
    chat: { maxImages: 0, maxPromptChars: 20_000, supportsVision: false }
  }
}

function values(overrides: Partial<ProviderFormValues> = {}): ProviderFormValues {
  return {
    presetId: 'deepseek-chat',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    kind: 'chat',
    adapter: 'openai-compatible',
    manualModel: '',
    apiKey: 'sk-test',
    enabled: true,
    ...overrides
  }
}

function port(overrides: Partial<ProviderModelsPort> = {}): ProviderModelsPort {
  return {
    storeSecret: vi.fn(async () => ({ secretRef: 'sec_01J00000000000000000000001' })),
    deleteSecret: vi.fn(async () => undefined),
    previewModels: vi.fn(async () => [MODEL]),
    refreshModels: vi.fn(async () => {
      throw new Error('not used')
    }),
    ...overrides
  } as ProviderModelsPort
}

describe('model preview flow', () => {
  it('stores a draft secret and previews a fixed provider', async () => {
    const p = port()
    const result = await previewModelsForForm(p, values(), 'provider-draft:test')
    expect(p.storeSecret).toHaveBeenCalledWith({
      label: 'provider-draft:test',
      value: 'sk-test'
    })
    expect(p.previewModels).toHaveBeenCalledWith({
      target: 'preset',
      presetId: 'deepseek-chat',
      secretRef: 'sec_01J00000000000000000000001'
    })
    expect(result.models).toEqual([MODEL])
  })

  it('requires a key and a valid custom URL', async () => {
    await expect(
      previewModelsForForm(port(), values({ apiKey: '' }), 'provider-draft:test')
    ).rejects.toBeInstanceOf(ProviderFormError)
    await expect(
      previewModelsForForm(
        port(),
        values({ presetId: 'custom', baseUrl: 'ftp://example.com' }),
        'provider-draft:test'
      )
    ).rejects.toBeInstanceOf(ProviderFormError)
  })
})
