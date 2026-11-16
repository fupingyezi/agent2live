import { describe, expect, it } from 'vitest'
import type { ProviderConnectionDto } from '@studio/api'
import {
  PROVIDER_PRESETS,
  findDefaultTextProvider,
  findDefaultVisionProvider,
  getProviderPreset,
  initialProviderValues,
  presetIdForConnection
} from './presets'

function connection(patch: Partial<ProviderConnectionDto> = {}): ProviderConnectionDto {
  return {
    id: 'conn_test',
    label: 'Test',
    kind: 'chat',
    adapter: 'openai-compatible',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-5.3-flash',
    enabled: true,
    capabilities: {
      schemaVersion: 'provider-capabilities/1',
      chat: { maxImages: 6, maxPromptChars: 20_000, supportsVision: true }
    },
    hasSecret: true,
    createdAt: '2026-11-16T00:00:00.000Z',
    updatedAt: '2026-11-16T00:00:00.000Z',
    rowVersion: 1,
    ...patch
  }
}

describe('provider presets', () => {
  it('offers the six Phase 1 connection shapes', () => {
    expect(PROVIDER_PRESETS.map((preset) => preset.id)).toEqual([
      'openai-chat',
      'deepseek-chat',
      'zhipu-vision',
      'seedream-image',
      'mock-chat',
      'mock-image'
    ])
    expect(getProviderPreset('deepseek-chat')).toMatchObject({
      kind: 'chat',
      adapter: 'openai-compatible',
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-flash',
      requiresSecret: true
    })
    expect(getProviderPreset('deepseek-chat').capabilities.chat).toMatchObject({
      maxImages: 0,
      supportsVision: false
    })
    expect(getProviderPreset('zhipu-vision')).toMatchObject({
      name: '智谱多模态',
      kind: 'chat',
      adapter: 'openai-compatible',
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      model: 'glm-5.3-flash',
      requiresSecret: true
    })
    expect(getProviderPreset('zhipu-vision').capabilities.chat).toMatchObject({
      maxImages: 6,
      supportsVision: true
    })
    expect(getProviderPreset('seedream-image')).toMatchObject({
      kind: 'image',
      adapter: 'seedream',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
      model: 'doubao-seedream-5-0-pro-260628',
      requiresSecret: true
    })
    expect(getProviderPreset('seedream-image').capabilities.image?.maxCount).toBe(4)
    expect(getProviderPreset('openai-chat').capabilities.chat?.supportsVision).toBe(true)
    expect(getProviderPreset('mock-chat').requiresSecret).toBe(false)
    expect(getProviderPreset('mock-image').capabilities.image?.sizes).toEqual(['512x896', '1024x1792'])
  })

  it('selects only an enabled Zhipu GLM vision connection', () => {
    expect(findDefaultVisionProvider([connection({ id: 'conn_zhipu' })])?.id).toBe('conn_zhipu')

    expect(
      findDefaultVisionProvider([
        connection({ id: 'conn_openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4.1-mini' }),
        connection({ id: 'conn_glm_text', baseUrl: 'https://api.zhipu.test/v4', model: 'glm-5.3-flash' }),
        connection({ id: 'conn_disabled', enabled: false }),
        connection({
          id: 'conn_no_vision',
          capabilities: {
            schemaVersion: 'provider-capabilities/1',
            chat: { maxImages: 0, maxPromptChars: 20_000, supportsVision: false }
          }
        })
      ])
    ).toBeNull()
  })

  it('selects only an enabled DeepSeek text connection', () => {
    expect(
      findDefaultTextProvider([
        connection({
          id: 'conn_deepseek',
          baseUrl: 'https://api.deepseek.com/v1',
          model: 'deepseek-chat',
          capabilities: {
            schemaVersion: 'provider-capabilities/1',
            chat: { maxImages: 0, maxPromptChars: 20_000, supportsVision: false }
          }
        })
      ])?.id
    ).toBe('conn_deepseek')

    expect(
      findDefaultTextProvider([
        connection({ id: 'conn_zhipu' }),
        connection({ id: 'conn_disabled', enabled: false }),
        connection({
          id: 'conn_openai',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-4.1-mini',
          capabilities: {
            schemaVersion: 'provider-capabilities/1',
            chat: { maxImages: 0, maxPromptChars: 20_000, supportsVision: false }
          }
        })
      ])
    ).toBeNull()
  })

  it('seeds editable values and never invents an API key', () => {
    const values = initialProviderValues(getProviderPreset('openai-chat'))
    expect(values).toEqual({
      presetId: 'openai-chat',
      label: 'OpenAI 兼容对话',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4.1-mini',
      apiKey: '',
      enabled: true
    })
    expect(initialProviderValues(getProviderPreset('mock-image'))).toMatchObject({
      baseUrl: '',
      model: '',
      apiKey: '',
      enabled: true
    })
  })

  it('maps an existing connection back to its editing preset', () => {
    expect(presetIdForConnection({ adapter: 'seedream', kind: 'image' })).toBe('seedream-image')
    expect(
      presetIdForConnection({
        adapter: 'openai-compatible',
        kind: 'chat',
        baseUrl: 'https://api.deepseek.com/v1',
        model: 'deepseek-flash'
      })
    ).toBe('deepseek-chat')
    expect(
      presetIdForConnection({
        adapter: 'openai-compatible',
        kind: 'chat',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4.1-mini'
      })
    ).toBe('openai-chat')
    expect(presetIdForConnection({ adapter: 'mock', kind: 'chat' })).toBe('mock-chat')
    expect(presetIdForConnection({ adapter: 'mock', kind: 'image' })).toBe('mock-image')
    expect(() => getProviderPreset('nope')).toThrow('未知的连接类型')
  })
})
