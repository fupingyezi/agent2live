import { describe, expect, it } from 'vitest'
import type { ProviderConnectionDto } from '@studio/api'
import {
  FIXED_PROVIDER_PRESETS,
  findDefaultTextSelection,
  findDefaultVisionSelection,
  initialProviderValues,
  presetIdForConnection,
  providerCounts,
  providerModels
} from './presets'

const CHAT = {
  schemaVersion: 'provider-capabilities/1' as const,
  chat: { maxImages: 0, maxPromptChars: 20_000, supportsVision: false }
}
const VISION = {
  schemaVersion: 'provider-capabilities/1' as const,
  chat: { maxImages: 8, maxPromptChars: 20_000, supportsVision: true }
}
const IMAGE = {
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

function connection(patch: Partial<ProviderConnectionDto> = {}): ProviderConnectionDto {
  return {
    id: 'conn_1',
    label: '火山方舟',
    kind: 'chat',
    adapter: 'openai-compatible',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    model: 'chat-a',
    enabled: true,
    capabilities: CHAT,
    models: [
      { id: 'chat-a', name: null, kind: 'chat', adapter: 'openai-compatible', capabilities: CHAT },
      { id: 'vision-a', name: null, kind: 'chat', adapter: 'openai-compatible', capabilities: VISION },
      { id: 'image-a', name: null, kind: 'image', adapter: 'seedream', capabilities: IMAGE }
    ],
    modelsRefreshedAt: '2026-11-23T00:00:00.000Z',
    hasSecret: true,
    createdAt: '2026-11-23T00:00:00.000Z',
    updatedAt: '2026-11-23T00:00:00.000Z',
    rowVersion: 1,
    ...patch
  }
}

describe('provider catalog helpers', () => {
  it('exposes the four create targets and seeds fixed values', () => {
    expect(FIXED_PROVIDER_PRESETS.map((preset) => preset.id)).toEqual([
      'deepseek-chat',
      'zhipu-vision',
      'volcengine-ark'
    ])
    expect(initialProviderValues('deepseek-chat')).toMatchObject({
      presetId: 'deepseek-chat',
      label: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com/v1',
      kind: 'chat',
      adapter: 'openai-compatible'
    })
    expect(initialProviderValues('custom')).toMatchObject({ presetId: 'custom', label: '自定义' })
  })

  it('derives preset ids, counts and default selections from the catalog', () => {
    const ark = connection()
    expect(presetIdForConnection(ark)).toBe('volcengine-ark')
    expect(presetIdForConnection(connection({ baseUrl: 'https://example.com/v1' }))).toBe('custom')
    expect(presetIdForConnection(connection({ adapter: 'mock', baseUrl: null }))).toBeNull()
    expect(providerCounts(ark)).toEqual({ chat: 1, vision: 1, image: 1 })
    expect(providerModels(ark, 'chat').map((model) => model.id)).toEqual(['chat-a', 'vision-a'])
    expect(findDefaultTextSelection([ark])).toMatchObject({ model: { id: 'chat-a' } })
    expect(findDefaultVisionSelection([ark])).toMatchObject({ model: { id: 'vision-a' } })
  })
})
