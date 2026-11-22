import { AppError } from '../errors'
import type { ProviderConnectionService } from './provider-connections'
import type { SecretResolver } from './secret-resolver'
import type { ProviderModelSelection } from '@agent2live/contracts'
import {
  OpenAIChatProvider,
  SeedreamImageProvider,
  createMockArtProvider,
  type ChatProvider,
  type ImageProvider
} from '@agent2live/providers'

export class ProviderRegistry {
  constructor(
    private readonly connections: ProviderConnectionService,
    private readonly secrets: SecretResolver
  ) {}

  async chat(connectionId: string, selection: ProviderModelSelection): Promise<ChatProvider> {
    const row = this.connections.getRow(connectionId)
    if (!row.enabled) throw new AppError('PROVIDER_NOT_CONFIGURED', { connectionId })
    if (selection.adapter === 'mock') return createMockArtProvider().chat
    if (selection.adapter !== 'openai-compatible') {
      throw new AppError('PROVIDER_CAPABILITY_UNSUPPORTED', { capability: 'chat' })
    }
    if (!row.base_url) throw new AppError('PROVIDER_NOT_CONFIGURED', { connectionId })
    const apiKey = row.secret_ref ? await this.secrets.resolve(row.secret_ref) : null
    if (!apiKey) throw new AppError('PROVIDER_NOT_CONFIGURED', { connectionId })
    return new OpenAIChatProvider({
      baseUrl: row.base_url,
      model: selection.modelId,
      apiKey
    })
  }

  async image(connectionId: string, selection: ProviderModelSelection): Promise<ImageProvider> {
    const row = this.connections.getRow(connectionId)
    if (!row.enabled) throw new AppError('PROVIDER_NOT_CONFIGURED', { connectionId })
    if (selection.adapter === 'mock') return createMockArtProvider().image
    if (selection.adapter !== 'seedream') {
      throw new AppError('PROVIDER_CAPABILITY_UNSUPPORTED', { capability: 'image' })
    }
    const apiKey = row.secret_ref ? await this.secrets.resolve(row.secret_ref) : null
    if (!apiKey) throw new AppError('PROVIDER_NOT_CONFIGURED', { connectionId })
    return new SeedreamImageProvider({
      baseUrl: row.base_url ?? 'https://ark.cn-beijing.volces.com/api/v3',
      model: selection.modelId,
      apiKey
    })
  }
}
