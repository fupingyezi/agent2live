import type { FastifyInstance, FastifyRequest } from 'fastify'
import {
  commitPromptDraftInputSchema,
  createDraftInputSchema,
  hashCanonical,
  promptInputMultipartMetadataSchema,
  savePromptDraftInputSchema,
  type PromptInputMultipartMetadata
} from '@agent2live/contracts'
import { AppError } from '../errors'
import type { Services } from '../services/container'
import type { PromptVersionDto } from '../services/prompt-versions'
import { parseIfMatch } from '../http/conditional'
import { idsOf, requireIdempotencyKey } from './helpers'
import { mapMultipartError, readMultipart, UPLOAD_FILE_LIMIT, type MultipartResult } from './multipart'

function ifMatchValue(request: FastifyRequest): string | undefined {
  const raw = request.headers['if-match']
  if (Array.isArray(raw)) {
    throw new AppError('REQUEST_INVALID', { reason: 'invalid If-Match header' })
  }
  return raw
}

function parseMetadata(value: string): PromptInputMultipartMetadata {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new AppError('REQUEST_INVALID', { reason: 'invalid metadata JSON' })
  }
  return promptInputMultipartMetadataSchema.parse(parsed)
}

async function readInputMultipart(request: FastifyRequest): Promise<MultipartResult> {
  try {
    return await readMultipart(request, {
      maxFiles: 14,
      maxFileBytes: UPLOAD_FILE_LIMIT,
      maxFieldBytes: 64 * 1024
    })
  } catch (error) {
    mapMultipartError(error)
  }
}

export function registerPromptRoutes(
  app: FastifyInstance,
  services: Pick<Services, 'inputs' | 'drafts' | 'versions' | 'idempotency'>
): void {
  app.post('/api/v1/art-projects/:id/prompt-inputs', async (request, reply) => {
    const projectId = (request.params as { id: string }).id
    const parsed = await readInputMultipart(request)
    const metadataJson = parsed.fields.get('metadata')
    if (!metadataJson) throw new AppError('REQUEST_INVALID', { reason: 'metadata required' })
    const metadata = parseMetadata(metadataJson)
    const rawIfMatch = ifMatchValue(request)
    const expected = rawIfMatch ? parseIfMatch(rawIfMatch) : null
    const result = await services.inputs.ingest(projectId, metadata, parsed.files, expected, idsOf(request))
    reply.status(201)
    return result
  })

  app.post('/api/v1/art-projects/:id/prompt-drafts', async (request, reply) => {
    const projectId = (request.params as { id: string }).id
    const key = requireIdempotencyKey(request)
    const input = createDraftInputSchema.parse(request.body ?? {})
    const result = services.idempotency.run(
      `prompt.draft.create:${projectId}`,
      key,
      hashCanonical({ projectId, input }),
      () => {
        const draft = services.drafts.create(projectId, input, idsOf(request))
        return { status: 201, body: draft }
      }
    )
    reply.status(result.response.status)
    return result.response.body
  })

  app.patch('/api/v1/art-projects/:id/prompt-drafts/:draftId', async (request, reply) => {
    const { id: projectId, draftId } = request.params as { id: string; draftId: string }
    const expected = parseIfMatch(ifMatchValue(request))
    const input = savePromptDraftInputSchema.parse(request.body)
    const draft = services.drafts.save(projectId, draftId, expected, input.state, idsOf(request))
    reply.header('etag', `"${draft.rowVersion}"`)
    return draft
  })

  app.post('/api/v1/art-projects/:id/prompt-drafts/:draftId/commit', async (request, reply) => {
    const { id: projectId, draftId } = request.params as { id: string; draftId: string }
    const expected = parseIfMatch(ifMatchValue(request))
    const key = requireIdempotencyKey(request)
    const input = commitPromptDraftInputSchema.parse(request.body ?? {})
    const result = services.idempotency.run(
      `prompt.draft.commit:${draftId}`,
      key,
      hashCanonical({ projectId, draftId, expected, input }),
      () => {
        const committed = services.drafts.commit(
          projectId,
          draftId,
          expected,
          input.acknowledgeUncoveredRequirements,
          idsOf(request)
        )
        return { status: 201, body: committed }
      }
    )
    reply.status(result.response.status)
    if (
      result.response.body &&
      typeof result.response.body === 'object' &&
      'version' in result.response.body
    ) {
      const version = (result.response.body as { version: PromptVersionDto }).version
      reply.header('etag', `"${version.versionNumber}"`)
    }
    return result.response.body
  })

  app.get('/api/v1/art-projects/:id/prompt', async (request) => {
    return services.drafts.getWorkspace((request.params as { id: string }).id)
  })

  app.get('/api/v1/art-projects/:id/prompt-versions', async (request) => {
    return services.versions.list((request.params as { id: string }).id)
  })

  app.get('/api/v1/art-projects/:id/prompt-versions/:versionId', async (request) => {
    const { id, versionId } = request.params as { id: string; versionId: string }
    return services.versions.get(id, versionId)
  })
}
