import { describe, expect, it } from 'vitest'
import type { ProviderConnectionDto } from '@studio/api'
import {
  FIXED_PROVIDER_PRESETS,
  findDefaultTextSelection,
  findDefaultVisionSelection,
  initialProviderConnectionValues,
  modelOptionLabel,
  modelsForConnectionKind,
  presetIdForConnection,
  connectionModelCounts,
  connectionDisplayName,
  connectionModels
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
  it('exposes the six fixed providers and seeds default models', () => {
    expect(FIXED_PROVIDER_PRESETS.map((preset) => preset.id)).toEqual([
      'deepseek-chat',
      'zhipu-vision',
      'volcengine-ark',
      'kimi-chat',
      'qwen-chat',
      'minimax-chat'
    ])
    expect(initialProviderConnectionValues('deepseek-chat')).toMatchObject({
      presetId: 'deepseek-chat',
      label: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com/v1',
      kind: 'chat',
      adapter: 'openai-compatible',
      defaultModelId: 'deepseek-flash'
    })
    expect(initialProviderConnectionValues('custom')).toMatchObject({
      presetId: 'custom',
      label: '自定义',
      defaultModelId: ''
    })
  })

  it('derives preset ids, counts and default selections from the catalog', () => {
    const ark = connection()
    expect(presetIdForConnection(ark)).toBe('volcengine-ark')
    expect(presetIdForConnection(connection({ baseUrl: 'https://example.com/v1' }))).toBe('custom')
    expect(presetIdForConnection(connection({ adapter: 'mock', baseUrl: null }))).toBeNull()
    // 视觉模型同时也是对话模型，对话计数包含视觉。
    expect(connectionModelCounts(ark)).toEqual({ chat: 2, vision: 1, image: 1 })
    expect(connectionModels(ark, 'chat').map((model) => model.id)).toEqual(['chat-a', 'vision-a'])
    expect(modelsForConnectionKind(ark.models, 'image').map((model) => model.id)).toEqual(['image-a'])
    expect(modelsForConnectionKind(ark.models, 'chat').map((model) => model.id)).toEqual([
      'chat-a',
      'vision-a'
    ])
    expect(findDefaultTextSelection([ark])).toMatchObject({ model: { id: 'chat-a' } })
    expect(findDefaultVisionSelection([ark])).toMatchObject({ model: { id: 'vision-a' } })
    expect(modelOptionLabel(ark.models[0]!)).toContain('（对话）')
    expect(modelOptionLabel(ark.models[1]!)).toContain('（对话 · 视觉）')
    expect(modelOptionLabel(ark.models[2]!)).toContain('（生图）')
    expect(connectionDisplayName(ark)).toBe('火山方舟')
    expect(connectionDisplayName(connection({ baseUrl: 'https://example.com/v1' }))).toBe(
      '自定义 · example.com'
    )
  })

  it('prefers the connection default model selected in settings', () => {
    const selected = connection({ model: 'vision-a' })
    expect(findDefaultTextSelection([selected])).toMatchObject({ model: { id: 'vision-a' } })
    expect(findDefaultVisionSelection([selected])).toMatchObject({ model: { id: 'vision-a' } })
  })

  it('falls back to a vision chat model when the catalog has no text-only model', () => {
    const visionOnly = connection({
      models: [
        { id: 'vision-only', name: null, kind: 'chat', adapter: 'openai-compatible', capabilities: VISION },
        { id: 'image-a', name: null, kind: 'image', adapter: 'seedream', capabilities: IMAGE }
      ]
    })
    expect(findDefaultTextSelection([visionOnly])).toMatchObject({ model: { id: 'vision-only' } })
    expect(findDefaultTextSelection([connection({ enabled: false })])).toBeNull()
  })
})
