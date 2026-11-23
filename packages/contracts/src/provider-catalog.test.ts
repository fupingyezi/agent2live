import { describe, expect, it } from 'vitest'
import {
  FIXED_PROVIDER_PRESETS,
  fixedPresetForBaseUrl,
  providerConfigSchema,
  providerModelProfileSchema,
  providerModelProfilesSchema,
  providerModelsPreviewInputSchema
} from './provider-catalog'

const CHAT = {
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

describe('provider catalog', () => {
  it('exposes the six fixed presets (plus custom) with built-in models', () => {
    expect(FIXED_PROVIDER_PRESETS.map((preset) => preset.id)).toEqual([
      'deepseek-chat',
      'zhipu-vision',
      'volcengine-ark',
      'kimi-chat',
      'qwen-chat',
      'minimax-chat'
    ])
    expect(fixedPresetForBaseUrl('https://api.deepseek.com/v1/')?.id).toBe('deepseek-chat')
    expect(fixedPresetForBaseUrl('https://ark.cn-beijing.volces.com/api/v3')?.id).toBe('volcengine-ark')
    expect(fixedPresetForBaseUrl('https://api.moonshot.cn/v1')?.id).toBe('kimi-chat')
    expect(fixedPresetForBaseUrl('https://dashscope.aliyuncs.com/compatible-mode/v1')?.id).toBe('qwen-chat')
    expect(fixedPresetForBaseUrl('https://api.minimaxi.com/v1')?.id).toBe('minimax-chat')
    expect(fixedPresetForBaseUrl('https://example.com/v1')).toBeNull()
    for (const preset of FIXED_PROVIDER_PRESETS) {
      expect(preset.presetModels.length).toBeGreaterThan(0)
    }
  })

  it('validates model profiles against their kind', () => {
    expect(
      providerModelProfileSchema.parse({
        id: 'doubao-seed-1-6',
        name: 'Doubao Seed',
        kind: 'chat',
        adapter: 'openai-compatible',
        capabilities: CHAT
      })
    ).toMatchObject({ kind: 'chat' })
    expect(() =>
      providerModelProfileSchema.parse({
        id: 'bad-chat',
        name: null,
        kind: 'chat',
        adapter: 'openai-compatible',
        capabilities: IMAGE
      })
    ).toThrow()
    expect(() =>
      providerModelProfileSchema.parse({
        id: 'bad-image',
        name: null,
        kind: 'image',
        adapter: 'openai-compatible',
        capabilities: IMAGE
      })
    ).toThrow()
    expect(
      providerModelProfileSchema.parse({
        id: 'doubao-seedream',
        name: null,
        kind: 'image',
        adapter: 'seedream',
        capabilities: IMAGE
      })
    ).toMatchObject({ adapter: 'seedream' })
  })

  it('rejects duplicate model ids and parses config', () => {
    expect(() =>
      providerModelProfilesSchema.parse([
        { id: 'same', name: null, kind: 'chat', adapter: 'openai-compatible', capabilities: CHAT },
        { id: 'same', name: null, kind: 'chat', adapter: 'openai-compatible', capabilities: CHAT }
      ])
    ).toThrow()
    expect(
      providerConfigSchema.parse({
        schemaVersion: 'provider-config/1',
        models: [{ id: 'chat-1', name: null, kind: 'chat', adapter: 'openai-compatible', capabilities: CHAT }]
      })
    ).toMatchObject({ modelsRefreshedAt: null })
  })

  it('rejects invalid custom preview protocol combinations', () => {
    const secretRef = 'sec_01J00000000000000000000000'
    expect(
      providerModelsPreviewInputSchema.parse({
        target: 'custom',
        kind: 'chat',
        adapter: 'openai-compatible',
        baseUrl: 'https://example.com/v1',
        secretRef
      })
    ).toMatchObject({ target: 'custom' })
    expect(() =>
      providerModelsPreviewInputSchema.parse({
        target: 'custom',
        kind: 'chat',
        adapter: 'seedream',
        baseUrl: 'https://example.com/v1',
        secretRef
      })
    ).toThrow()
    expect(() =>
      providerModelsPreviewInputSchema.parse({
        target: 'custom',
        kind: 'image',
        adapter: 'openai-compatible',
        baseUrl: 'https://example.com/v1',
        secretRef
      })
    ).toThrow()
  })
})
