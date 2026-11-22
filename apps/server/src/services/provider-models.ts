import {
  fixedPresetForBaseUrl,
  getFixedProviderPreset,
  type ProviderModelListDto,
  type ProviderModelsPreviewInput,
  type ProviderModelProfile
} from '@agent2live/contracts'
import { discoverModels, type ModelDiscoveryFlavor } from '@agent2live/providers'
import { AppError } from '../errors'
import { providerFailureAppError } from './provider-diagnostics'
import type { ProviderConnectionDto, ProviderConnectionService } from './provider-connections'
import type { RequestIds } from './request-ids'
import type { SecretResolver } from './secret-resolver'

export interface ProviderModelDiscoveryInput {
  baseUrl: string
  apiKey: string
  flavor: ModelDiscoveryFlavor
  requestId: string
}

export type ProviderModelDiscover = (input: ProviderModelDiscoveryInput) => Promise<ProviderModelProfile[]>

export class ProviderModelsService {
  constructor(
    private readonly deps: {
      connections: ProviderConnectionService
      secrets: SecretResolver
      discover?: ProviderModelDiscover
    }
  ) {}

  private discover(input: ProviderModelDiscoveryInput): Promise<ProviderModelProfile[]> {
    return (this.deps.discover ?? discoverModels)(input)
  }

  private async resolveSecret(secretRef: string): Promise<string> {
    try {
      return await this.deps.secrets.resolve(secretRef)
    } catch {
      throw new AppError('PROVIDER_NOT_CONFIGURED', {})
    }
  }

  private async runDiscovery(input: ProviderModelDiscoveryInput): Promise<ProviderModelListDto> {
    try {
      return { items: await this.discover(input) }
    } catch (error) {
      const mapped = providerFailureAppError(error)
      if (mapped) throw mapped
      throw error
    }
  }

  async preview(input: ProviderModelsPreviewInput, requestId: string): Promise<ProviderModelListDto> {
    const apiKey = await this.resolveSecret(input.secretRef)
    if (input.target === 'preset') {
      const preset = getFixedProviderPreset(input.presetId)
      if (!preset) throw new AppError('REQUEST_INVALID', { reason: 'unknown provider preset' })
      return this.runDiscovery({
        baseUrl: preset.baseUrl,
        apiKey,
        flavor: preset.flavor,
        requestId
      })
    }
    return this.runDiscovery({
      baseUrl: input.baseUrl,
      apiKey,
      flavor: input.kind === 'chat' ? 'custom-chat' : 'custom-image',
      requestId
    })
  }

  async refresh(
    connectionId: string,
    expectedVersion: number,
    ids: RequestIds
  ): Promise<ProviderConnectionDto> {
    const row = this.deps.connections.getRow(connectionId)
    if (row.adapter === 'mock') {
      throw new AppError('REQUEST_INVALID', { reason: 'mock connections have no model list' })
    }
    if (!row.secret_ref) throw new AppError('PROVIDER_NOT_CONFIGURED', { connectionId })
    const apiKey = await this.resolveSecret(row.secret_ref)
    const preset = fixedPresetForBaseUrl(row.base_url)
    const baseUrl = preset?.baseUrl ?? row.base_url
    if (!baseUrl) throw new AppError('REQUEST_INVALID', { reason: 'connection has no base url' })
    const flavor: ModelDiscoveryFlavor =
      preset?.flavor ?? (row.adapter === 'seedream' ? 'custom-image' : 'custom-chat')
    const result = await this.runDiscovery({
      baseUrl,
      apiKey,
      flavor,
      requestId: ids.requestId
    })
    return this.deps.connections.update(connectionId, { models: result.items }, expectedVersion, ids)
  }
}
