import {
  MOCK_ART_CAPABILITIES,
  MOCK_CHAT_CAPABILITIES,
  OPENAI_COMPATIBLE_VISION_CAPABILITIES,
  SEEDREAM_CAPABILITIES
} from '@agent2live/contracts/capabilities'
import type { ProviderCapabilities } from '@agent2live/contracts'
import type { ProviderConnectionDto } from '@studio/api'

const DEEPSEEK_CHAT_CAPABILITIES: ProviderCapabilities = {
  schemaVersion: 'provider-capabilities/1',
  chat: {
    maxImages: 0,
    maxPromptChars: 20_000,
    supportsVision: false
  }
}

const ZHIPU_VISION_CAPABILITIES: ProviderCapabilities = {
  schemaVersion: 'provider-capabilities/1',
  chat: {
    maxImages: 6,
    maxPromptChars: 20_000,
    supportsVision: true
  }
}

export type ProviderPresetId =
  | 'openai-chat'
  | 'deepseek-chat'
  | 'zhipu-vision'
  | 'seedream-image'
  | 'mock-chat'
  | 'mock-image'

export interface ProviderPreset {
  id: ProviderPresetId
  name: string
  description: string
  kind: 'chat' | 'image'
  adapter: 'openai-compatible' | 'seedream' | 'mock'
  baseUrl: string | null
  model: string | null
  requiresSecret: boolean
  capabilities: ProviderCapabilities
}

export interface ProviderFormValues {
  presetId: ProviderPresetId
  label: string
  baseUrl: string
  model: string
  apiKey: string
  enabled: boolean
}

export const PROVIDER_PRESETS: readonly ProviderPreset[] = [
  {
    id: 'openai-chat',
    name: 'OpenAI 兼容对话',
    description: '用于提示词反推与修改建议。兼容 /v1/chat/completions。',
    kind: 'chat',
    adapter: 'openai-compatible',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4.1-mini',
    requiresSecret: true,
    capabilities: OPENAI_COMPATIBLE_VISION_CAPABILITIES
  },
  {
    id: 'deepseek-chat',
    name: 'DeepSeek 对话',
    description: 'DeepSeek Flash 文本模型，用于提示词修改建议与后续直接聊天。',
    kind: 'chat',
    adapter: 'openai-compatible',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-flash',
    requiresSecret: true,
    capabilities: DEEPSEEK_CHAT_CAPABILITIES
  },
  {
    id: 'zhipu-vision',
    name: '智谱多模态',
    description: '智谱 GLM 视觉模型，用于参考图分析与提示词反推。',
    kind: 'chat',
    adapter: 'openai-compatible',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-5.3-flash',
    requiresSecret: true,
    capabilities: ZHIPU_VISION_CAPABILITIES
  },
  {
    id: 'seedream-image',
    name: 'Seedream 生图',
    description: '火山方舟 Seedream 4.0，用于立绘候选生成。',
    kind: 'image',
    adapter: 'seedream',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    model: 'doubao-seedream-5-0-pro-260628',
    requiresSecret: true,
    capabilities: SEEDREAM_CAPABILITIES
  },
  {
    id: 'mock-chat',
    name: 'Mock 对话',
    description: '离线确定性的对话 mock，用于本地联调与门禁。',
    kind: 'chat',
    adapter: 'mock',
    baseUrl: null,
    model: null,
    requiresSecret: false,
    capabilities: MOCK_CHAT_CAPABILITIES
  },
  {
    id: 'mock-image',
    name: 'Mock 生图',
    description: '离线确定性的 PNG mock，不访问网络。',
    kind: 'image',
    adapter: 'mock',
    baseUrl: null,
    model: null,
    requiresSecret: false,
    capabilities: MOCK_ART_CAPABILITIES
  }
] as const

export function getProviderPreset(id: string): ProviderPreset {
  const preset = PROVIDER_PRESETS.find((candidate) => candidate.id === id)
  if (!preset) throw new Error(`未知的连接类型：${id}`)
  return preset
}

export function initialProviderValues(preset: ProviderPreset): ProviderFormValues {
  return {
    presetId: preset.id,
    label: preset.name,
    baseUrl: preset.baseUrl ?? '',
    model: preset.model ?? '',
    apiKey: '',
    enabled: true
  }
}

export function presetIdForConnection(connection: {
  adapter: ProviderPreset['adapter']
  kind: ProviderPreset['kind']
  baseUrl?: string | null
  model?: string | null
}): ProviderPresetId {
  if (connection.adapter === 'mock') return connection.kind === 'chat' ? 'mock-chat' : 'mock-image'
  if (connection.adapter === 'seedream') return 'seedream-image'
  if (connection.baseUrl?.includes('open.bigmodel.cn') || connection.model?.startsWith('glm-')) {
    return 'zhipu-vision'
  }
  if (connection.baseUrl?.includes('api.deepseek.com') || connection.model?.startsWith('deepseek-')) {
    return 'deepseek-chat'
  }
  return 'openai-chat'
}

function isZhipuVisionProvider(provider: ProviderConnectionDto): boolean {
  return (
    provider.baseUrl?.includes('open.bigmodel.cn') === true && provider.model?.startsWith('glm-') === true
  )
}

export function findDefaultVisionProvider(providers: ProviderConnectionDto[]): ProviderConnectionDto | null {
  const visionProviders = providers.filter((provider) => {
    const capabilities = provider.capabilities as ProviderCapabilities | null
    return provider.enabled && provider.kind === 'chat' && capabilities?.chat?.supportsVision === true
  })
  return visionProviders.find(isZhipuVisionProvider) ?? visionProviders[0] ?? null
}

export function findDefaultTextProvider(providers: ProviderConnectionDto[]): ProviderConnectionDto | null {
  return (
    providers.find((provider) => {
      const capabilities = provider.capabilities as ProviderCapabilities | null
      return (
        provider.enabled &&
        provider.kind === 'chat' &&
        capabilities?.chat !== undefined &&
        capabilities.chat.supportsVision !== true &&
        provider.baseUrl?.includes('api.deepseek.com') === true &&
        provider.model?.startsWith('deepseek-') === true
      )
    }) ?? null
  )
}
