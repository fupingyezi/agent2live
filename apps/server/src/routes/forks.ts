import type { FastifyInstance } from 'fastify'
import {
  characterLineageQuerySchema,
  createForkInputSchema,
  hashCanonical,
  patchForkInputSchema
} from '@agent2live/contracts'
import { idsOf, requireIdempotencyKey } from './helpers'
import type { ForkResultDto, ForkLinkMutationDto, ForkService } from '../services/forks'
import type { IdempotencyService } from '../services/idempotency'

export function registerForkRoutes(
  app: FastifyInstance,
  deps: {
    forks: ForkService
    idempotency: IdempotencyService
  }
): void {
  app.get('/api/v1/art-projects/tree', async (request) => {
    const query = characterLineageQuerySchema.parse(request.query)
    return deps.forks.lineage(query.characterId)
  })

  app.post('/api/v1/prompt-versions/:versionId/forks', async (request, reply) => {
    const { versionId } = request.params as { versionId: string }
    const key = requireIdempotencyKey(request)
    const input = createForkInputSchema.parse(request.body)
    const result = deps.idempotency.run(
      `fork.promptVersion:${versionId}`,
      key,
      hashCanonical({ versionId, input }),
      () => {
        const body = deps.forks.createFromPromptVersion(versionId, input, idsOf(request))
        return { status: 201, body }
      }
    )
    const body = result.response.body as ForkResultDto
    reply
      .status(result.response.status)
      .header('location', `/api/v1/art-projects/${body.childProject.id}`)
      .header('etag', `"${body.childProject.rowVersion}"`)
    return body
  })

  app.post('/api/v1/art-versions/:versionId/forks', async (request, reply) => {
    const { versionId } = request.params as { versionId: string }
    const key = requireIdempotencyKey(request)
    const input = createForkInputSchema.parse(request.body)
    const result = deps.idempotency.run(
      `fork.artVersion:${versionId}`,
      key,
      hashCanonical({ versionId, input }),
      () => {
        const body = deps.forks.createFromArtVersion(versionId, input, idsOf(request))
        return { status: 201, body }
      }
    )
    const body = result.response.body as ForkResultDto
    reply
      .status(result.response.status)
      .header('location', `/api/v1/art-projects/${body.childProject.id}`)
      .header('etag', `"${body.childProject.rowVersion}"`)
    return body
  })

  app.patch('/api/v1/art-projects/:id/fork-link', async (request, reply) => {
    const { id } = request.params as { id: string }
    const key = requireIdempotencyKey(request)
    const input = patchForkInputSchema.parse(request.body)
    const result = deps.idempotency.run(
      `fork.updateLink:${id}`,
      key,
      hashCanonical({ projectId: id, input }),
      () => {
        const body = deps.forks.updateLink(id, input, idsOf(request))
        return { status: 200, body }
      }
    )
    const body = result.response.body as ForkLinkMutationDto
    reply.status(result.response.status).header('etag', `"${body.childProject.rowVersion}"`)
    return body
  })
}
