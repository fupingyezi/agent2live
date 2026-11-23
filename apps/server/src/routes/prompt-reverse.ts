import type { FastifyInstance, FastifyRequest } from 'fastify'
import {
  applyPromptReverseInputSchema,
  listPromptReverseResultsQuerySchema,
  promptReverseInputSchema
} from '@agent2live/contracts'
import { AppError } from '../errors'
import { parseIfMatch } from '../http/conditional'
import type { JobEngine } from '../jobs/engine'
import { PROMPT_REVERSE_JOB_TYPE } from '../jobs/prompt-reverse'
import type { PromptReverseService } from '../services/prompt-reverse'
import { idsOf, requireIdempotencyKey } from './helpers'

function ifMatchValue(request: FastifyRequest): string | undefined {
  const raw = request.headers['if-match']
  // Node joins repeated headers with a comma before Fastify exposes them; both shapes mean multiple tags.
  if (Array.isArray(raw) || (typeof raw === 'string' && raw.includes(','))) {
    throw new AppError('REQUEST_INVALID', { reason: 'if_match_multiple' })
  }
  return raw
}

export function registerPromptReverseRoutes(
  app: FastifyInstance,
  services: { promptReverse: PromptReverseService; jobs: JobEngine }
): void {
  app.post('/api/v1/art-projects/:id/prompt-reverse', async (request, reply) => {
    const projectId = (request.params as { id: string }).id
    const key = requireIdempotencyKey(request)
    const input = promptReverseInputSchema.parse(request.body ?? {})
    const prepared = services.promptReverse.prepare(projectId, input, key)
    const job = services.jobs.enqueue({
      type: PROMPT_REVERSE_JOB_TYPE,
      payload: prepared.payload,
      idempotencyKey: `prompt.reverse:${projectId}:${key}`
    })
    reply.status(202)
    reply.header('location', `/api/v1/jobs/${job.id}`)
    return {
      jobId: job.id,
      baseDraftRevision: prepared.base.revision,
      baseDraftRowVersion: prepared.base.rowVersion
    }
  })

  app.get('/api/v1/art-projects/:id/prompt-reverse-results', async (request) => {
    const projectId = (request.params as { id: string }).id
    const query = listPromptReverseResultsQuerySchema.parse(request.query)
    return services.promptReverse.list(projectId, query)
  })

  app.get('/api/v1/prompt-reverse-results/:resultId', async (request) => {
    return services.promptReverse.get((request.params as { resultId: string }).resultId)
  })

  app.post('/api/v1/prompt-reverse-results/:resultId/apply', async (request, reply) => {
    const resultId = (request.params as { resultId: string }).resultId
    const expected = parseIfMatch(ifMatchValue(request))
    const input = applyPromptReverseInputSchema.parse(request.body ?? {})
    const result = services.promptReverse.apply(resultId, expected, idsOf(request), input.blockIds)
    reply.header('etag', `"${result.draft.rowVersion}"`)
    return result
  })

  app.post('/api/v1/prompt-reverse-results/:resultId/discard', async (request) => {
    const resultId = (request.params as { resultId: string }).resultId
    return services.promptReverse.discard(resultId, idsOf(request))
  })
}
