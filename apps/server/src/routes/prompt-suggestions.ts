import type { FastifyInstance } from 'fastify'
import {
  acceptSuggestionInputSchema,
  emptyBodySchema,
  promptSuggestionInputSchema
} from '@agent2live/contracts'
import type { JobEngine } from '../jobs/engine'
import { PROMPT_SUGGESTION_JOB_TYPE } from '../jobs/prompt-suggestion'
import type { PromptSuggestionService } from '../services/prompt-suggestions'
import { idsOf, requireIdempotencyKey } from './helpers'

export function registerPromptSuggestionRoutes(
  app: FastifyInstance,
  services: { promptSuggestions: PromptSuggestionService; jobs: JobEngine }
): void {
  app.post('/api/v1/prompt-versions/:versionId/suggestions', async (request, reply) => {
    const versionId = (request.params as { versionId: string }).versionId
    const key = requireIdempotencyKey(request)
    const input = promptSuggestionInputSchema.parse(request.body ?? {})
    const payload = services.promptSuggestions.prepareFromVersion(versionId, input)
    const job = services.jobs.enqueue({
      type: PROMPT_SUGGESTION_JOB_TYPE,
      payload,
      idempotencyKey: `prompt.suggestion:version:${versionId}:${key}`
    })
    reply.status(202)
    reply.header('location', `/api/v1/jobs/${job.id}`)
    return { jobId: job.id, baseContentHash: payload.baseContentHash }
  })

  app.post('/api/v1/art-projects/:id/prompt-drafts/:draftId/suggestions', async (request, reply) => {
    const { id, draftId } = request.params as { id: string; draftId: string }
    const key = requireIdempotencyKey(request)
    const input = promptSuggestionInputSchema.parse(request.body ?? {})
    const payload = services.promptSuggestions.prepareFromDraft(id, draftId, input)
    const job = services.jobs.enqueue({
      type: PROMPT_SUGGESTION_JOB_TYPE,
      payload,
      idempotencyKey: `prompt.suggestion:draft:${draftId}:${key}`
    })
    reply.status(202)
    reply.header('location', `/api/v1/jobs/${job.id}`)
    return { jobId: job.id, baseContentHash: payload.baseContentHash }
  })

  app.get('/api/v1/prompt-suggestions/:suggestionId', async (request) => {
    return services.promptSuggestions.get((request.params as { suggestionId: string }).suggestionId)
  })

  app.post('/api/v1/prompt-suggestions/:suggestionId/accept', async (request) => {
    const suggestionId = (request.params as { suggestionId: string }).suggestionId
    const input = acceptSuggestionInputSchema.parse(request.body ?? {})
    return services.promptSuggestions.accept(suggestionId, input.expectedDraftRowVersion, idsOf(request))
  })

  app.post('/api/v1/prompt-suggestions/:suggestionId/reject', async (request) => {
    const suggestionId = (request.params as { suggestionId: string }).suggestionId
    emptyBodySchema.parse(request.body ?? {})
    return services.promptSuggestions.reject(suggestionId, idsOf(request))
  })
}
