import {
  providerCapabilitiesSchema,
  type ProviderProbeDto,
  type ProviderProbeInput
} from '@agent2live/contracts'
import { ProviderError } from '@agent2live/providers'
import { AppError } from '../errors'
import type { Clock } from './clock'
import type { ProviderConnectionService } from './provider-connections'
import type { ProviderRegistry } from './provider-registry'

interface ProviderProbeDeps {
  connections: Pick<ProviderConnectionService, 'getRow'>
  registry: Pick<ProviderRegistry, 'chat' | 'image'>
  clock: Pick<Clock, 'now'>
}

function providerFailure(error: unknown): never {
  if (error instanceof ProviderError) throw new AppError(error.code)
  throw error
}

export class ProviderProbeService {
  constructor(private readonly deps: ProviderProbeDeps) {}

  async probe(connectionId: string, input: ProviderProbeInput, requestId: string): Promise<ProviderProbeDto> {
    const connection = this.deps.connections.getRow(connectionId)
    const startedAt = Date.now()
    if (connection.kind === 'chat') {
      const provider = await this.deps.registry.chat(connectionId)
      try {
        const result = await provider.generate(
          {
            messages: [{ role: 'user', content: 'Reply with OK.' }],
            maxTokens: 8
          },
          { requestId }
        )
        return {
          ok: true,
          kind: 'chat',
          adapter: connection.adapter,
          model: result.model,
          latencyMs: Math.max(0, Date.now() - startedAt),
          checkedAt: this.deps.clock.now(),
          billable: false
        }
      } catch (error) {
        providerFailure(error)
      }
    }

    if (!input.allowBillableRequest) {
      throw new AppError('PROVIDER_BILLABLE_CONFIRMATION_REQUIRED', { connectionId })
    }
    const capabilities = providerCapabilitiesSchema.parse(JSON.parse(connection.capabilities_json))
    const size = capabilities.image?.sizes[0]
    if (!size) throw new AppError('PROVIDER_CAPABILITY_UNSUPPORTED', { capability: 'image' })
    const provider = await this.deps.registry.image(connectionId)
    try {
      const result = await provider.generate(
        {
          prompt: 'A single small neutral color square.',
          size,
          count: 1
        },
        { requestId }
      )
      if (result.images.length !== 1) {
        throw new AppError('PROVIDER_INVALID_RESPONSE')
      }
      return {
        ok: true,
        kind: 'image',
        adapter: connection.adapter,
        model: result.model,
        latencyMs: Math.max(0, Date.now() - startedAt),
        checkedAt: this.deps.clock.now(),
        billable: true
      }
    } catch (error) {
      providerFailure(error)
    }
  }
}
