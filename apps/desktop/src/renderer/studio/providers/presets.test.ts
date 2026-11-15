import { describe, expect, it } from 'vitest'
import { PROVIDER_PRESETS, getProviderPreset, initialProviderValues, presetIdForConnection } from './presets'

describe('provider presets', () => {
  it('offers exactly the five Phase 1 connection shapes', () => {
    expect(PROVIDER_PRESETS.map((preset) => preset.id)).toEqual([
      'openai-chat',
      'deepseek-chat',
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
