import type { FastifyInstance } from 'fastify'
import {
  acceptGenerationCandidateInputSchema,
  activateArtVersionInputSchema,
  artVersionListQuerySchema,
  createManualArtVersionInputSchema,
  hashCanonical,
  restoreArtVersionInputSchema,
  reviseArtVersionReferencesInputSchema
} from '@agent2live/contracts'
import { idsOf, requireIdempotencyKey } from './helpers'
import { parseIfMatch } from '../http/conditional'
import { AppError } from '../errors'
import type { ArtVersionMutationDto, ArtVersionService } from '../services/art-versions'
import type { IdempotencyService } from '../services/idempotency'

function parseReferenceRevision(body: unknown) {
  const parsed = reviseArtVersionReferencesInputSchema.safeParse(body)
  if (parsed.success) return parsed.data
  const messages = parsed.error.issues.map((issue) => issue.message)
  if (messages.some((message) => message.includes('exactly one primary'))) {
    throw new AppError('ART_REFERENCE_PRIMARY_REQUIRED', {})
  }
  if (messages.some((message) => message.includes('sortOrder 0') || message.includes('continuous 1..N-1'))) {
    const references =
      typeof body === 'object' &&
      body !== null &&
      Array.isArray((body as { references?: unknown }).references)
        ? (body as { references: Array<{ sortOrder?: unknown; isPrimary?: unknown }> }).references
        : []
    const primarySortOrder = references.find((reference) => reference.isPrimary === true)?.sortOrder
    throw new AppError('ART_REFERENCE_ORDER_INVALID', {
      primarySortOrder:
        typeof primarySortOrder === 'number' && Number.isInteger(primarySortOrder) && primarySortOrder >= 0
          ? primarySortOrder
          : 0,
      orders: references
        .map((reference) => reference.sortOrder)
        .filter(
          (order): order is number => typeof order === 'number' && Number.isInteger(order) && order >= 0
        )
        .slice(0, 32)
    })
  }
  throw new AppError('ART_REFERENCE_SET_INVALID', { reasons: messages.slice(0, 20) })
}

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

  app.get('/api/v1/art-versions/:versionId/references', async (request) => {
    const { versionId } = request.params as { versionId: string }
    return deps.artVersions.getReferences(versionId)
  })

  app.post('/api/v1/art-versions/:versionId/reference-revisions', async (request, reply) => {
    const { versionId } = request.params as { versionId: string }
    const key = requireIdempotencyKey(request)
    const expected = parseIfMatch(request.headers['if-match'] as string | undefined)
    const input = parseReferenceRevision(request.body)
    const result = deps.idempotency.run(
      `artVersion.reviseReferences:${versionId}`,
      key,
      hashCanonical({ versionId, input, expectedProjectRowVersion: expected }),
      () => {
        const mutation = deps.artVersions.reviseReferences({
          versionId,
          references: input.references,
          reason: input.reason,
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
      .header('location', `/api/v1/art-projects/${body.project.id}/art-versions/${body.artVersion.id}`)
    return body
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
          role: input.role,
          note: input.note,
          weight: input.weight,
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

  app.post('/api/v1/art-projects/:id/art-versions/:versionId/restore', async (request, reply) => {
    const { id, versionId } = request.params as { id: string; versionId: string }
    const key = requireIdempotencyKey(request)
    const expected = parseIfMatch(request.headers['if-match'] as string | undefined)
    restoreArtVersionInputSchema.parse(request.body ?? {})
    const result = deps.idempotency.run(
      `artVersion.restore:${id}:${versionId}`,
      key,
      hashCanonical({ projectId: id, versionId, expectedProjectRowVersion: expected }),
      () => {
        const mutation = deps.artVersions.restore({
          projectId: id,
          versionId,
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
