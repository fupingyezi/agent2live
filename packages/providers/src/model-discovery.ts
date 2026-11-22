import {
  SEEDREAM_CAPABILITIES,
  type ProviderCapabilities,
  type ProviderModelProfile
} from '@agent2live/contracts'
import { ProviderError } from './errors'
import { getJson } from './http'
import type { ProviderRequestContext } from './types'

export type ModelDiscoveryFlavor = 'deepseek' | 'zhipu' | 'ark' | 'custom-chat' | 'custom-image'

const EXCLUDED_ZHIPU = /embedding|cogview|cogvideo|tts|asr|rerank|image|video|audio|moderation|voice/i
const EXCLUDED_CHAT =
  /embedding|rerank|tts|asr|image|video|audio|cogview|wanx|seedream|dall-e|flux|sdxl|stable-diffusion/i
// 自定义生图只有 Seedream 适配器；其他生图家族的模型无法按该协议调用，不能自动展示。
const IMAGE_FAMILY = /seedream|seededit/i
const ARK_NON_CHAT = /seedream|seedance|embedding|tts|asr|video|audio/i

interface RawModel {
  id: string
  name: string | null
  raw: Record<string, unknown>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function inputModalities(raw: Record<string, unknown>): string[] {
  const top = stringArray(raw.input_modalities)
  if (top.length > 0) return top
  const modalities = isRecord(raw.modalities) ? raw.modalities : null
  return modalities ? stringArray(modalities.input_modalities) : []
}

function outputModalities(raw: Record<string, unknown>): string[] {
  const top = stringArray(raw.output_modalities)
  if (top.length > 0) return top
  const modalities = isRecord(raw.modalities) ? raw.modalities : null
  return modalities ? stringArray(modalities.output_modalities) : []
}

function supportsImageInput(raw: Record<string, unknown>): boolean {
  if (raw.supports_image_in === true) return true
  return inputModalities(raw).includes('image')
}

function modelName(raw: Record<string, unknown>): string | null {
  if (typeof raw.name !== 'string') return null
  const name = raw.name.trim()
  return name.length > 0 ? name.slice(0, 200) : null
}

function parseModels(json: Record<string, unknown>): RawModel[] {
  const data = json.data
  if (!Array.isArray(data)) {
    throw new ProviderError('PROVIDER_INVALID_RESPONSE', 'model list is invalid')
  }
  const seen = new Set<string>()
  const models: RawModel[] = []
  for (const entry of data) {
    if (!isRecord(entry)) continue
    const id = typeof entry.id === 'string' ? entry.id.trim() : ''
    if (!id || id.length > 200 || seen.has(id)) continue
    seen.add(id)
    models.push({ id, name: modelName(entry), raw: entry })
    if (models.length === 200) break
  }
  return models
}

function chatCapabilities(supportsVision: boolean, maxImages = 8): ProviderCapabilities {
  return {
    schemaVersion: 'provider-capabilities/1',
    chat: {
      maxImages: supportsVision ? maxImages : 0,
      maxPromptChars: 20_000,
      supportsVision
    }
  }
}

function profile(
  model: RawModel,
  kind: 'chat' | 'image',
  adapter: 'openai-compatible' | 'seedream',
  capabilities: ProviderCapabilities
): ProviderModelProfile {
  return { id: model.id, name: model.name, kind, adapter, capabilities }
}

function arkDomain(raw: Record<string, unknown>): string | null {
  return typeof raw.domain === 'string' ? raw.domain : null
}

function arkTaskType(raw: Record<string, unknown>): string {
  return typeof raw.task_type === 'string' ? raw.task_type : ''
}

function arkImage(raw: Record<string, unknown>): boolean {
  if (arkDomain(raw) === 'ImageGeneration') return true
  if (/image[_-]?generation/i.test(arkTaskType(raw))) return true
  const outputs = outputModalities(raw)
  return outputs.includes('image') && !outputs.includes('text')
}

function arkChat(raw: Record<string, unknown>): boolean {
  const domain = arkDomain(raw)
  if (domain) return domain === 'LLM' || domain === 'VLM'
  const id = typeof raw.id === 'string' ? raw.id : ''
  return !ARK_NON_CHAT.test(id)
}

export function profilesFromModelList(
  flavor: ModelDiscoveryFlavor,
  json: Record<string, unknown>
): ProviderModelProfile[] {
  const models = parseModels(json)
  if (flavor === 'deepseek') {
    return models
      .filter((model) => {
        const outputs = outputModalities(model.raw)
        return outputs.length === 0 || outputs.includes('text')
      })
      .map((model) =>
        profile(model, 'chat', 'openai-compatible', chatCapabilities(supportsImageInput(model.raw)))
      )
  }
  if (flavor === 'zhipu') {
    return models
      .filter((model) => !EXCLUDED_ZHIPU.test(model.id))
      .map((model) => profile(model, 'chat', 'openai-compatible', chatCapabilities(true, 6)))
  }
  if (flavor === 'ark') {
    const profiles: ProviderModelProfile[] = []
    for (const model of models) {
      if (arkImage(model.raw)) {
        profiles.push(profile(model, 'image', 'seedream', SEEDREAM_CAPABILITIES))
        continue
      }
      if (!arkChat(model.raw)) continue
      const vision = arkDomain(model.raw) === 'VLM' || supportsImageInput(model.raw)
      profiles.push(profile(model, 'chat', 'openai-compatible', chatCapabilities(vision)))
    }
    return profiles
  }
  if (flavor === 'custom-chat') {
    return models
      .filter((model) => !EXCLUDED_CHAT.test(model.id))
      .map((model) =>
        profile(model, 'chat', 'openai-compatible', chatCapabilities(supportsImageInput(model.raw)))
      )
  }
  return models
    .filter((model) => IMAGE_FAMILY.test(model.id))
    .map((model) => profile(model, 'image', 'seedream', SEEDREAM_CAPABILITIES))
}

export async function discoverModels(input: {
  baseUrl: string
  apiKey: string
  flavor: ModelDiscoveryFlavor
  requestId: string
  timeoutMs?: number
}): Promise<ProviderModelProfile[]> {
  const timeoutMs = input.timeoutMs ?? 30_000
  const context: ProviderRequestContext = {
    requestId: input.requestId,
    timeoutMs
  }
  const base = input.baseUrl.replace(/\/+$/, '')
  let response: Awaited<ReturnType<typeof getJson>>
  try {
    response = await getJson(`${base}/models`, input.apiKey, context, timeoutMs)
  } catch (error) {
    if (error instanceof ProviderError && error.providerStatus === 404) {
      throw new ProviderError('PROVIDER_MODELS_UNSUPPORTED', 'provider does not support model discovery', {
        providerStatus: 404
      })
    }
    throw error
  }
  return profilesFromModelList(input.flavor, response.json)
}
