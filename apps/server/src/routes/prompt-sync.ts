import type { FastifyInstance, FastifyRequest } from 'fastify'
import { promptSyncInputSchema } from '@agent2live/contracts'
import type { JobEngine } from '../jobs/engine'
import { PROMPT_SYNC_JOB_TYPE } from '../jobs/prompt-sync'
import type { PromptSyncService } from '../services/prompt-sync'
import { parseIfMatch } from '../http/conditional'
import { requireIdempotencyKey } from './helpers'

function ifMatchValue(request: FastifyRequest): string | undefined {
  const raw = request.headers['if-match']
  return Array.isArray(raw) ? raw[0] : raw
}

export function registerPromptSyncRoutes(
  app: FastifyInstance,
  services: { promptSync: PromptSyncService; jobs: JobEngine }
): void {
  app.post('/api/v1/art-projects/:id/prompt-drafts/:draftId/sync', async (request, reply) => {
    const { id, draftId } = request.params as { id: string; draftId: string }
    const key = requireIdempotencyKey(request)
    const input = promptSyncInputSchema.parse(request.body ?? {})
    const payload = services.promptSync.prepare(id, draftId, parseIfMatch(ifMatchValue(request)), input)
    const job = services.jobs.enqueue({
      type: PROMPT_SYNC_JOB_TYPE,
      payload,
      idempotencyKey: `prompt.sync:${draftId}:${key}`
    })
    reply.status(202)
    reply.header('location', `/api/v1/jobs/${job.id}`)
    return { jobId: job.id }
  })
}
