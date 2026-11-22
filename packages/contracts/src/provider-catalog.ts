import { z } from 'zod'
import { providerCapabilitiesSchema } from './prompt'
import { providerBaseUrlSchema, providerSecretRefSchema } from './provider-shared'

export const FIXED_PROVIDER_IDS = ['deepseek-chat', 'zhipu-vision', 'volcengine-ark'] as const
export const fixedProviderPresetIdSchema = z.enum(FIXED_PROVIDER_IDS)
export const providerPresetIdSchema = z.enum([...FIXED_PROVIDER_IDS, 'custom'])
export const CUSTOM_PROVIDER_ID = 'custom' as const

export type FixedProviderPresetId = z.infer<typeof fixedProviderPresetIdSchema>
export type ProviderPresetId = z.infer<typeof providerPresetIdSchema>

export interface FixedProviderPreset {
  id: FixedProviderPresetId
  name: string
  description: string
  baseUrl: string
  flavor: 'deepseek' | 'zhipu' | 'ark'
}

export const FIXED_PROVIDER_PRESETS: readonly FixedProviderPreset[] = [
  {
    id: 'deepseek-chat',
    name: 'DeepSeek',
    description: 'DeepSeek 对话与视觉模型。',
    baseUrl: 'https://api.deepseek.com/v1',
    flavor: 'deepseek'
  },
  {
    id: 'zhipu-vision',
    name: '智谱 GLM',
    description: '智谱 GLM 对话与视觉模型。',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    flavor: 'zhipu'
  },
  {
    id: 'volcengine-ark',
    name: '火山方舟',
    description: '火山方舟对话、视觉与 Seedream 生图模型。',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    flavor: 'ark'
  }
] as const

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
