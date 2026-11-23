import type { ImageCapabilityProfile, ProviderCapabilities } from './prompt'

export type { ProviderCapabilities } from './prompt'

export const SEEDREAM_CAPABILITIES: ProviderCapabilities = {
  schemaVersion: 'provider-capabilities/1',
  image: {
    maxReferenceImages: 14,
    maxPromptChars: 20_000,
    supportsNegativePrompt: false,
    supportsWeightSyntax: false,
    supportsSeed: true,
    maxCount: 4,
    sizes: ['1024x1024', '1024x1536', '1536x1024', '1584x2816', '2048x2048', '4096x4096']
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
