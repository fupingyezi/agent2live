import { AppError } from '../errors'
import type { ProviderConnectionService } from './provider-connections'
import type { SecretResolver } from './secret-resolver'
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

  async chat(connectionId: string): Promise<ChatProvider> {
    const row = this.connections.getRow(connectionId)
    if (!row.enabled) throw new AppError('PROVIDER_NOT_CONFIGURED', { connectionId })
    if (row.adapter === 'mock') return createMockArtProvider().chat
    if (row.adapter !== 'openai-compatible') {
      throw new AppError('PROVIDER_CAPABILITY_UNSUPPORTED', { capability: 'chat' })
    }
    const apiKey = row.secret_ref ? await this.secrets.resolve(row.secret_ref) : null
    if (!apiKey) throw new AppError('PROVIDER_NOT_CONFIGURED', { connectionId })
    return new OpenAIChatProvider({
      baseUrl: row.base_url!,
      model: row.model!,
      apiKey
    })
  }

  async image(connectionId: string): Promise<ImageProvider> {
    const row = this.connections.getRow(connectionId)
    if (!row.enabled) throw new AppError('PROVIDER_NOT_CONFIGURED', { connectionId })
    if (row.adapter === 'mock') {
      return createMockArtProvider().image
    }
    if (row.adapter !== 'seedream') {
      throw new AppError('PROVIDER_CAPABILITY_UNSUPPORTED', { capability: 'image' })
    }
    const apiKey = row.secret_ref ? await this.secrets.resolve(row.secret_ref) : null
    if (!apiKey) throw new AppError('PROVIDER_NOT_CONFIGURED', { connectionId })
    return new SeedreamImageProvider({
      baseUrl: row.base_url ?? 'https://ark.cn-beijing.volces.com/api/v3',
      model: row.model!,
      apiKey
    })
  }
}
