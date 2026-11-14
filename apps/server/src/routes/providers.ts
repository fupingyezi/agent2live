import type { FastifyInstance } from 'fastify'
import {
  hashCanonical,
  createProviderConnectionInputSchema,
  updateProviderConnectionInputSchema
} from '@agent2live/contracts'
import { AppError } from '../errors'
import { parseIfMatch } from '../http/conditional'
import type { IdempotencyService } from '../services/idempotency'
import type { ProviderConnectionDto, ProviderConnectionService } from '../services/provider-connections'
import type { SecretResolver } from '../services/secret-resolver'
import { idsOf, requireIdempotencyKey } from './helpers'

async function assertSecretAvailable(
  secrets: SecretResolver,
  secretRef: string | null | undefined
): Promise<void> {
  if (!secretRef) return
  try {
    await secrets.resolve(secretRef)
  } catch {
    throw new AppError('PROVIDER_NOT_CONFIGURED', {})
  }
}

export function registerProviderRoutes(
  app: FastifyInstance,
  deps: {
    connections: ProviderConnectionService
    secrets: SecretResolver
    idempotency: IdempotencyService
  }
): void {
  app.get('/api/v1/providers', async () => ({ items: deps.connections.list() }))
  app.get('/api/v1/providers/:id', async (request) =>
    deps.connections.get((request.params as { id: string }).id)
  )

  app.post('/api/v1/providers', async (request, reply) => {
    const key = requireIdempotencyKey(request)
    const input = createProviderConnectionInputSchema.parse(request.body)
    await assertSecretAvailable(deps.secrets, input.secretRef)
    const result = deps.idempotency.run('provider.create', key, hashCanonical(input), () => {
      const dto = deps.connections.create(input, idsOf(request))
      return { status: 201, body: dto }
    })
    const dto = result.response.body as ProviderConnectionDto
    reply
      .status(result.response.status)
      .header('etag', `"${dto.rowVersion}"`)
      .header('location', `/api/v1/providers/${dto.id}`)
    return dto
  })

  app.patch('/api/v1/providers/:id', async (request, reply) => {
    const id = (request.params as { id: string }).id
    const header = request.headers['if-match']
    const expected = parseIfMatch(Array.isArray(header) ? header[0] : header)
    const patch = updateProviderConnectionInputSchema.parse(request.body)
    const current = deps.connections.getRow(id)
    const secretRef = patch.secretRef === undefined ? current.secret_ref : patch.secretRef
    if (patch.secretRef !== undefined || (patch.enabled ?? Boolean(current.enabled))) {
      await assertSecretAvailable(deps.secrets, secretRef)
    }
    const dto = deps.connections.update(id, patch, expected, idsOf(request))
    reply.header('etag', `"${dto.rowVersion}"`)
    return dto
  })
}
