import { z } from 'zod'
import {
  SEEDREAM_4_0_CAPABILITIES,
  SEEDREAM_4_5_CAPABILITIES,
  SEEDREAM_5_CAPABILITIES,
  SEEDREAM_5_LITE_CAPABILITIES,
  SEEDREAM_CAPABILITIES
} from './capabilities'
import { providerCapabilitiesSchema, type ProviderCapabilities } from './prompt'
import { providerBaseUrlSchema, providerSecretRefSchema } from './provider-shared'

export const FIXED_PROVIDER_IDS = [
  'deepseek-chat',
  'zhipu-vision',
  'volcengine-ark',
  'kimi-chat',
  'qwen-chat',
  'minimax-chat'
] as const
export const fixedProviderPresetIdSchema = z.enum(FIXED_PROVIDER_IDS)
export const providerPresetIdSchema = z.enum([...FIXED_PROVIDER_IDS, 'custom'])
export const CUSTOM_PROVIDER_ID = 'custom' as const

export type FixedProviderPresetId = z.infer<typeof fixedProviderPresetIdSchema>
export type ProviderPresetId = z.infer<typeof providerPresetIdSchema>

const TEXT_CHAT_CAPABILITIES: ProviderCapabilities = {
  schemaVersion: 'provider-capabilities/1',
  chat: { maxImages: 0, maxPromptChars: 20_000, supportsVision: false }
}

const VISION_CHAT_CAPABILITIES: ProviderCapabilities = {
  schemaVersion: 'provider-capabilities/1',
  chat: { maxImages: 6, maxPromptChars: 20_000, supportsVision: true }
}

function chatModel(id: string, name: string, supportsVision = false): ProviderModelProfile {
  return {
    id,
    name,
    kind: 'chat',
    adapter: 'openai-compatible',
    capabilities: supportsVision ? VISION_CHAT_CAPABILITIES : TEXT_CHAT_CAPABILITIES
  }
}

function imageModel(
  id: string,
  name: string,
  capabilities: ProviderCapabilities = SEEDREAM_CAPABILITIES
): ProviderModelProfile {
  return {
    id,
    name,
    kind: 'image',
    adapter: 'seedream',
    capabilities
  }
}

export interface FixedProviderPreset {
  id: FixedProviderPresetId
  name: string
  description: string
  baseUrl: string
  flavor: 'deepseek' | 'zhipu' | 'ark' | 'custom-chat'
  presetModels: ProviderModelProfile[]
}

/**
 * 预设模型 ID 均来自真实供应商目录：
 * - DeepSeek、智谱、火山方舟：2026-11-23 实际请求 /models 返回
 * - Kimi、通义千问、MiniMax：官方模型文档核对
 * 更新模型时请重新请求 /models 或查官方文档，不要凭印象补模型名。
 */
export const FIXED_PROVIDER_PRESETS: readonly FixedProviderPreset[] = [
  {
    id: 'deepseek-chat',
    name: 'DeepSeek',
    description: 'DeepSeek 对话与视觉模型。',
    baseUrl: 'https://api.deepseek.com/v1',
    flavor: 'deepseek',
    presetModels: [
      chatModel('deepseek-flash', 'DeepSeek-V4.1-Flash', true),
      chatModel('deepseek-v4-pro', 'DeepSeek-V4-Pro')
    ]
  },
  {
    id: 'zhipu-vision',
    name: '智谱 GLM',
    description: '智谱 GLM 对话与视觉模型。',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    flavor: 'zhipu',
    presetModels: [
      chatModel('glm-5.4', 'GLM-5.4', true),
      chatModel('glm-5.3', 'GLM-5.3', true),
      chatModel('glm-5.3-flash', 'GLM-5.3 Flash', true)
    ]
  },
  {
    id: 'volcengine-ark',
    name: '火山方舟',
    description: '火山方舟对话、视觉与 Seedream 生图模型。',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    flavor: 'ark',
    presetModels: [
      chatModel('doubao-seed-2-1-pro-260915', 'Doubao Seed 2.1 Pro', true),
      chatModel('doubao-seed-2-1-lite-260915', 'Doubao Seed 2.1 Lite', true),
      chatModel('deepseek-v4-1-flash-261017', 'DeepSeek V4.1 Flash', true),
      imageModel('doubao-seedream-5-5-261028', 'Seedream 5.5', SEEDREAM_5_CAPABILITIES),
      imageModel('doubao-seedream-5-0-flash-260915', 'Seedream 5.0 Flash', SEEDREAM_5_CAPABILITIES),
      imageModel('doubao-seedream-5-0-pro-260628', 'Seedream 5.0 Pro', SEEDREAM_5_CAPABILITIES),
      imageModel('doubao-seedream-5-0-260128', 'Seedream 5.0', SEEDREAM_5_LITE_CAPABILITIES),
      imageModel('doubao-seedream-4-5-251128', 'Seedream 4.5', SEEDREAM_4_5_CAPABILITIES),
      imageModel('doubao-seedream-4-0-20260415', 'Seedream 4.0', SEEDREAM_4_0_CAPABILITIES)
    ]
  },
  {
    id: 'kimi-chat',
    name: 'Kimi',
    description: '月之暗面 Kimi 对话与视觉模型。',
    baseUrl: 'https://api.moonshot.cn/v1',
    flavor: 'custom-chat',
    presetModels: [chatModel('kimi-k3', 'Kimi K3', true), chatModel('kimi-k3.1-pro', 'Kimi K3.1 Pro', true)]
  },
  {
    id: 'qwen-chat',
    name: '通义千问',
    description: '阿里云百炼通义千问对话与视觉模型。',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    flavor: 'custom-chat',
    presetModels: [
      chatModel('qwen4-max', 'Qwen4 Max'),
      chatModel('qwen3.8-max', 'Qwen3.8 Max'),
      chatModel('qwen3-vl-plus', 'Qwen3 VL Plus', true)
    ]
  },
  {
    id: 'minimax-chat',
    name: 'MiniMax',
    description: 'MiniMax M3 对话与视觉模型。',
    baseUrl: 'https://api.minimaxi.com/v1',
    flavor: 'custom-chat',
    presetModels: [
      chatModel('MiniMax-M3.1-Flash', 'MiniMax M3.1 Flash', true),
      chatModel('MiniMax-M3', 'MiniMax M3', true)
    ]
  }
]

export function getFixedProviderPreset(id: string): FixedProviderPreset | null {
  return FIXED_PROVIDER_PRESETS.find((preset) => preset.id === id) ?? null
}

export function normalizeProviderUrl(value: string): string {
  return value.replace(/\/+$/, '')
}

export function fixedPresetForBaseUrl(baseUrl: string | null | undefined): FixedProviderPreset | null {
  if (!baseUrl) return null
  const normalized = normalizeProviderUrl(baseUrl)
  return FIXED_PROVIDER_PRESETS.find((preset) => normalizeProviderUrl(preset.baseUrl) === normalized) ?? null
}

export const providerModelProfileSchema = z
  .object({
    id: z.string().trim().min(1).max(200),
    name: z.string().trim().min(1).max(200).nullable(),
    kind: z.enum(['chat', 'image']),
    adapter: z.enum(['openai-compatible', 'seedream', 'mock']),
    capabilities: providerCapabilitiesSchema
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.kind === 'chat' && value.adapter === 'seedream') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['adapter'],
        message: 'chat models cannot use the seedream adapter'
      })
    }
    if (value.kind === 'image' && value.adapter === 'openai-compatible') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['adapter'],
        message: 'image models must use the seedream adapter'
      })
    }
    if (value.kind === 'chat' && !value.capabilities.chat) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['capabilities'],
        message: 'chat model requires chat capabilities'
      })
    }
    if (value.kind === 'image' && !value.capabilities.image) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['capabilities'],
        message: 'image model requires image capabilities'
      })
    }
  })

export type ProviderModelProfile = z.infer<typeof providerModelProfileSchema>

export const providerModelProfilesSchema = z
  .array(providerModelProfileSchema)
  .max(200)
  .superRefine((items, ctx) => {
    const seen = new Set<string>()
    items.forEach((item, index) => {
      if (seen.has(item.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, 'id'],
          message: 'duplicate model id'
        })
      }
      seen.add(item.id)
    })
  })

export const providerConfigSchema = z
  .object({
    schemaVersion: z.literal('provider-config/1'),
    models: providerModelProfilesSchema,
    modelsRefreshedAt: z.number().int().nonnegative().nullable().default(null)
  })
  .strict()

export type ProviderConfig = z.infer<typeof providerConfigSchema>

export const providerModelSelectionSchema = z
  .object({
    providerConnectionId: z.string().min(1).max(64),
    modelId: z.string().min(1).max(200),
    adapter: z.enum(['openai-compatible', 'seedream', 'mock']),
    capabilities: providerCapabilitiesSchema
  })
  .strict()

export type ProviderModelSelection = z.infer<typeof providerModelSelectionSchema>

export const providerModelsPreviewInputSchema = z
  .discriminatedUnion('target', [
    z
      .object({
        target: z.literal('preset'),
        presetId: fixedProviderPresetIdSchema,
        secretRef: providerSecretRefSchema
      })
      .strict(),
    z
      .object({
        target: z.literal('custom'),
        kind: z.enum(['chat', 'image']),
        adapter: z.enum(['openai-compatible', 'seedream']),
        baseUrl: providerBaseUrlSchema,
        secretRef: providerSecretRefSchema
      })
      .strict()
  ])
  .superRefine((value, ctx) => {
    if (value.target !== 'custom') return
    if (value.kind === 'chat' && value.adapter !== 'openai-compatible') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['adapter'],
        message: 'custom chat requires the openai-compatible adapter'
      })
    }
    if (value.kind === 'image' && value.adapter !== 'seedream') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['adapter'],
        message: 'custom image requires the seedream adapter'
      })
    }
  })

export type ProviderModelsPreviewInput = z.infer<typeof providerModelsPreviewInputSchema>

export const providerModelListDtoSchema = z.object({ items: providerModelProfilesSchema }).strict()

export type ProviderModelListDto = z.infer<typeof providerModelListDtoSchema>
