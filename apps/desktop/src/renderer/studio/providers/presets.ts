import {
  FIXED_PROVIDER_PRESETS,
  fixedPresetForBaseUrl,
  getFixedProviderPreset,
  type ProviderModelProfile,
  type ProviderPresetId
} from '@agent2live/contracts/provider-catalog'
import { SEEDREAM_CAPABILITIES, type ProviderCapabilities } from '@agent2live/contracts/capabilities'
import type { ProviderConnectionDto } from '@studio/api'

export { FIXED_PROVIDER_PRESETS, fixedPresetForBaseUrl, getFixedProviderPreset }
export type { ProviderModelProfile, ProviderPresetId }

export interface ProviderFormValues {
  presetId: ProviderPresetId
  label: string
  baseUrl: string
  kind: 'chat' | 'image'
  adapter: 'openai-compatible' | 'seedream'
  manualModel: string
  apiKey: string
  enabled: boolean
}

function textChatCapabilities(): ProviderCapabilities {
  return {
    schemaVersion: 'provider-capabilities/1',
    chat: { maxImages: 0, maxPromptChars: 20_000, supportsVision: false }
  }
}

export function presetModelsFor(presetId: ProviderPresetId): ProviderModelProfile[] {
  const preset = presetId === 'custom' ? null : getFixedProviderPreset(presetId)
  return preset ? preset.presetModels : []
}

export function initialProviderValues(presetId: ProviderPresetId): ProviderFormValues {
  const preset = presetId === 'custom' ? null : getFixedProviderPreset(presetId)
  return {
    presetId,
    label: preset?.name ?? '自定义',
    baseUrl: preset?.baseUrl ?? '',
    kind: 'chat',
    adapter: 'openai-compatible',
    manualModel: preset?.presetModels[0]?.id ?? '',
    apiKey: '',
    enabled: true
  }
}

export function presetIdForConnection(connection: ProviderConnectionDto): ProviderPresetId | null {
  if (connection.adapter === 'mock') return null
  return fixedPresetForBaseUrl(connection.baseUrl)?.id ?? 'custom'
}

export function providerModels(
  connection: ProviderConnectionDto,
  kind?: 'chat' | 'image'
): ProviderModelProfile[] {
  return kind ? connection.models.filter((model) => model.kind === kind) : connection.models
}

export function providerCounts(connection: ProviderConnectionDto): {
  chat: number
  vision: number
  image: number
} {
  let chat = 0
  let vision = 0
  let image = 0
  for (const model of connection.models) {
    if (model.kind === 'image') {
      image += 1
      continue
    }
    chat += 1
    if (model.capabilities.chat?.supportsVision === true) vision += 1
  }
  return { chat, vision, image }
}

export function modelKindLabel(model: ProviderModelProfile): string {
  if (model.kind === 'image') return '生图'
  return model.capabilities.chat?.supportsVision === true ? '对话 · 视觉' : '对话'
}

export function modelOptionLabel(model: ProviderModelProfile): string {
  return `${model.name ?? model.id}（${modelKindLabel(model)}）`
}

export function providerDisplayName(connection: ProviderConnectionDto): string {
  if (connection.adapter === 'mock') return 'Mock（旧连接）'
  const preset = fixedPresetForBaseUrl(connection.baseUrl)
  if (preset) return preset.name
  try {
    const host = new URL(connection.baseUrl ?? '').host
    return host ? `自定义 · ${host}` : '自定义'
  } catch {
    return '自定义'
  }
}

export function preferredModel(
  connection: ProviderConnectionDto,
  kind: 'chat' | 'image',
  requireVision = false
): ProviderModelProfile | null {
  const models = providerModels(connection, kind).filter(
    (model) => !requireVision || model.capabilities.chat?.supportsVision === true
  )
  return models.find((model) => model.id === connection.model) ?? models[0] ?? null
}

export function manualModelProfile(values: ProviderFormValues): ProviderModelProfile {
  const id = values.manualModel.trim()
  if (!id) throw new Error('MODEL_REQUIRED')
  return {
    id,
    name: null,
    kind: values.kind,
    adapter: values.adapter,
    capabilities: values.kind === 'image' ? SEEDREAM_CAPABILITIES : textChatCapabilities()
  }
}

export function findDefaultTextSelection(
  providers: ProviderConnectionDto[]
): { provider: ProviderConnectionDto; model: ProviderModelProfile } | null {
  const candidates = providers
    .filter((provider) => provider.enabled)
    .flatMap((provider) =>
      provider.models.filter((model) => model.kind === 'chat').map((model) => ({ provider, model }))
    )
  // 设置页选中的默认模型优先；否则优先纯文本模型，再次是任意 chat（VLM 也能处理文本）。
  const selected = candidates.find(({ provider, model }) => provider.model === model.id)
  if (selected) return selected
  const textOnly = candidates.filter(({ model }) => model.capabilities.chat?.supportsVision !== true)
  const pool = textOnly.length > 0 ? textOnly : candidates
  return pool.find(({ provider }) => provider.baseUrl?.includes('api.deepseek.com')) ?? pool[0] ?? null
}

export function findDefaultVisionSelection(
  providers: ProviderConnectionDto[]
): { provider: ProviderConnectionDto; model: ProviderModelProfile } | null {
  const candidates = providers
    .filter((provider) => provider.enabled)
    .flatMap((provider) =>
      provider.models
        .filter((model) => model.kind === 'chat' && model.capabilities.chat?.supportsVision === true)
        .map((model) => ({ provider, model }))
    )
  const selected = candidates.find(({ provider, model }) => provider.model === model.id)
  if (selected) return selected
  return (
    candidates.find(({ provider }) => provider.baseUrl?.includes('open.bigmodel.cn')) ?? candidates[0] ?? null
  )
}
