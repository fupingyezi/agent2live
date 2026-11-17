import type { FastifyInstance } from 'fastify'
import {
  acceptGenerationCandidateInputSchema,
  activateArtVersionInputSchema,
  artVersionListQuerySchema,
  createManualArtVersionInputSchema,
  hashCanonical
} from '@agent2live/contracts'
import { idsOf, requireIdempotencyKey } from './helpers'
import { parseIfMatch } from '../http/conditional'
import type { ArtVersionMutationDto, ArtVersionService } from '../services/art-versions'
import type { IdempotencyService } from '../services/idempotency'

export function registerArtVersionRoutes(
  app: FastifyInstance,
  deps: {
    artVersions: ArtVersionService
    idempotency: IdempotencyService
  }
): void {
  app.get('/api/v1/art-projects/:id/art-versions', async (request) => {
    const { id } = request.params as { id: string }
    const query = artVersionListQuerySchema.parse(request.query)
    return deps.artVersions.list(id, query.limit)
  })

  app.get('/api/v1/art-projects/:id/art-versions/:versionId', async (request) => {
    const { id, versionId } = request.params as { id: string; versionId: string }
    return deps.artVersions.get(id, versionId)
  })

  app.post('/api/v1/art-projects/:id/art-versions/manual', async (request, reply) => {
    const { id } = request.params as { id: string }
    const key = requireIdempotencyKey(request)
    const expected = parseIfMatch(request.headers['if-match'] as string | undefined)
    const input = createManualArtVersionInputSchema.parse(request.body)
    const result = deps.idempotency.run(
      `artVersion.manual:${id}`,
      key,
      hashCanonical({ projectId: id, input, expectedProjectRowVersion: expected }),
      () => {
        const mutation = deps.artVersions.createManual({
          projectId: id,
          assetId: input.assetId,
          ...(input.promptVersionId === undefined ? {} : { promptVersionId: input.promptVersionId }),
          expectedProjectRowVersion: expected,
          ctx: idsOf(request)
        })
        return { status: 201, body: mutation }
      }
    )
    const body = result.response.body as ArtVersionMutationDto
    reply
      .status(result.response.status)
      .header('etag', `"${body.project.rowVersion}"`)
      .header('location', `/api/v1/art-projects/${id}/art-versions/${body.artVersion.id}`)
    return body
  })

  app.post('/api/v1/generation-candidates/:candidateId/accept', async (request, reply) => {
    const { candidateId } = request.params as { candidateId: string }
    const key = requireIdempotencyKey(request)
    const input = acceptGenerationCandidateInputSchema.parse(request.body)
    const result = deps.idempotency.run(
      `artVersion.acceptCandidate:${candidateId}`,
      key,
      hashCanonical({ candidateId, input }),
      () => {
        const mutation = deps.artVersions.acceptCandidate({
          candidateId,
          expectedActiveArtVersionId: input.expectedActiveArtVersionId,
          ctx: idsOf(request)
        })
        return { status: 201, body: mutation }
      }
    )
    const body = result.response.body as ArtVersionMutationDto
    reply
      .status(result.response.status)
      .header('etag', `"${body.project.rowVersion}"`)
      .header('location', `/api/v1/art-projects/${body.project.id}/art-versions/${body.artVersion.id}`)
    return body
  })

  app.post('/api/v1/art-projects/:id/art-versions/:versionId/activate', async (request, reply) => {
    const { id, versionId } = request.params as { id: string; versionId: string }
    const key = requireIdempotencyKey(request)
    const expected = parseIfMatch(request.headers['if-match'] as string | undefined)
    const input = activateArtVersionInputSchema.parse(request.body)
    const result = deps.idempotency.run(
      `artVersion.activate:${id}`,
      key,
      hashCanonical({ projectId: id, versionId, reason: input.reason, expectedProjectRowVersion: expected }),
      () => {
        const mutation = deps.artVersions.activate({
          projectId: id,
          versionId,
          reason: input.reason,
          expectedProjectRowVersion: expected,
          ctx: idsOf(request)
        })
        return { status: 200, body: mutation }
      }
    )
    const body = result.response.body as ArtVersionMutationDto
    reply.status(result.response.status).header('etag', `"${body.project.rowVersion}"`)
    return body
  })
}
