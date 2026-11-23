import type { ImageCapabilityProfile, ProviderCapabilities } from './prompt'

export type { ProviderCapabilities } from './prompt'

/** Seedream 官方推荐尺寸；取自火山方舟图片生成 API 的“分辨率与宽高映射”。 */
const SEEDREAM_5_1K_SIZES = [
  '1024x1024',
  '1152x864',
  '864x1152',
  '1424x800',
  '800x1424',
  '1248x832',
  '832x1248',
  '1568x672'
]
const SEEDREAM_5_15K_SIZES = [
  '1536x1536',
  '1792x1344',
  '1344x1792',
  '2048x1152',
  '1152x2048',
  '1872x1248',
  '1248x1872',
  '2352x1008'
]
const SEEDREAM_5_2K_SIZES = [
  '2048x2048',
  '2368x1776',
  '1776x2368',
  '2816x1584',
  '1584x2816',
  '2496x1664',
  '1664x2496',
  '3136x1344'
]
const SEEDREAM_LITE_2K_SIZES = [
  '2048x2048',
  '2304x1728',
  '1728x2304',
  '2848x1600',
  '1600x2848',
  '2496x1664',
  '1664x2496',
  '3136x1344'
]
const SEEDREAM_LITE_3K_SIZES = [
  '3072x3072',
  '3456x2592',
  '2592x3456',
  '4096x2304',
  '2304x4096',
  '3744x2496',
  '2496x3744',
  '4704x2016'
]
const SEEDREAM_LITE_4K_SIZES = [
  '4096x4096',
  '4704x3520',
  '3520x4704',
  '5504x3040',
  '3040x5504',
  '4992x3328',
  '3328x4992',
  '6240x2656'
]
const SEEDREAM_4_1K_SIZES = [
  '1024x1024',
  '1152x864',
  '864x1152',
  '1280x720',
  '720x1280',
  '1248x832',
  '832x1248',
  '1512x648'
]

export const SEEDREAM_5_CAPABILITIES: ProviderCapabilities = seedreamCapabilities(
  ['2K', '1K', '1.5K', ...SEEDREAM_5_1K_SIZES, ...SEEDREAM_5_15K_SIZES, ...SEEDREAM_5_2K_SIZES],
  10
)
export const SEEDREAM_5_LITE_CAPABILITIES: ProviderCapabilities = seedreamCapabilities(
  ['2K', '3K', '4K', ...SEEDREAM_LITE_2K_SIZES, ...SEEDREAM_LITE_3K_SIZES, ...SEEDREAM_LITE_4K_SIZES],
  14
)
export const SEEDREAM_4_5_CAPABILITIES: ProviderCapabilities = seedreamCapabilities(
  ['2K', '4K', ...SEEDREAM_LITE_2K_SIZES, ...SEEDREAM_LITE_4K_SIZES],
  14
)
export const SEEDREAM_4_0_CAPABILITIES: ProviderCapabilities = seedreamCapabilities(
  ['2K', '1K', '4K', ...SEEDREAM_4_1K_SIZES, ...SEEDREAM_LITE_2K_SIZES, ...SEEDREAM_LITE_4K_SIZES],
  14
)

const ALL_SEEDREAM_SIZES = Array.from(
  new Set([
    '2K',
    '1K',
    '1.5K',
    '3K',
    '4K',
    ...SEEDREAM_5_1K_SIZES,
    ...SEEDREAM_5_15K_SIZES,
    ...SEEDREAM_5_2K_SIZES,
    ...SEEDREAM_LITE_2K_SIZES,
    ...SEEDREAM_LITE_3K_SIZES,
    ...SEEDREAM_LITE_4K_SIZES,
    ...SEEDREAM_4_1K_SIZES
  ])
)

/** 自定义 Seedream 连接无法预知具体模型，暴露官方支持的全部推荐尺寸。 */
export const SEEDREAM_CAPABILITIES: ProviderCapabilities = seedreamCapabilities(ALL_SEEDREAM_SIZES, 14)

function seedreamCapabilities(sizes: string[], maxReferenceImages: number): ProviderCapabilities {
  return {
    schemaVersion: 'provider-capabilities/1',
    image: {
      maxReferenceImages,
      maxPromptChars: 20_000,
      supportsNegativePrompt: false,
      supportsWeightSyntax: false,
      supportsSeed: true,
      maxCount: 4,
      sizes
    }
  }
}

export const OPENAI_COMPATIBLE_VISION_CAPABILITIES: ProviderCapabilities = {
  schemaVersion: 'provider-capabilities/1',
  chat: { maxImages: 8, maxPromptChars: 20_000, supportsVision: true }
}

export const MOCK_CHAT_CAPABILITIES: ProviderCapabilities = {
  schemaVersion: 'provider-capabilities/1',
  chat: { maxImages: 8, maxPromptChars: 20_000, supportsVision: true }
}

export const MOCK_ART_CAPABILITIES: ProviderCapabilities = {
  schemaVersion: 'provider-capabilities/1',
  chat: { maxImages: 8, maxPromptChars: 20_000, supportsVision: true },
  image: {
    maxReferenceImages: 4,
    maxPromptChars: 20_000,
    supportsNegativePrompt: true,
    supportsWeightSyntax: true,
    supportsSeed: true,
    maxCount: 4,
    sizes: ['512x896', '1024x1792']
  }
}

export function imageCapabilities(connection: {
  capabilities: ProviderCapabilities
  kind: 'chat' | 'image'
}): ImageCapabilityProfile {
  if (connection.kind !== 'image' || !connection.capabilities.image) {
    throw new Error('PROVIDER_CAPABILITY_UNSUPPORTED')
  }
  return connection.capabilities.image
}
