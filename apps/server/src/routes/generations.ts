import type { FastifyInstance } from 'fastify'
import { createGenerationInputSchema, hashCanonical, newId } from '@agent2live/contracts'
import { buildGenerationRequest } from '../generation/request'
import { IMAGE_GENERATION_JOB_TYPE } from '../jobs/image-generation'
import type { JobEngine } from '../jobs/engine'
import type { GenerationService } from '../services/generations'
import type { IdempotencyService } from '../services/idempotency'
import { idsOf, requireIdempotencyKey } from './helpers'

export function registerGenerationRoutes(
  app: FastifyInstance,
  deps: {
    generations: GenerationService
    jobs: JobEngine
    idempotency: IdempotencyService
  }
): void {
  app.post('/api/v1/art-projects/:id/generations', async (request, reply) => {
    const projectId = (request.params as { id: string }).id
    const key = requireIdempotencyKey(request)
    const input = createGenerationInputSchema.parse(request.body ?? {})
    const requestHash = hashCanonical({ projectId, input })
    const result = deps.idempotency.run(`generation.create:${projectId}`, key, requestHash, () => {
      const prepared = deps.generations.prepare(projectId, input)
      const generationJobId = newId('generationJob')
      const generationRequest = buildGenerationRequest(prepared, generationJobId)
      const job = deps.jobs.enqueue({
        type: IMAGE_GENERATION_JOB_TYPE,
        payload: generationRequest,
        idempotencyKey: `image.generate:${generationJobId}`
      })
      deps.generations.createRecord(generationRequest, job.id, idsOf(request))
      return {
        status: 202,
        body: {
          generationId: generationJobId,
          jobId: job.id,
          requestHash: generationRequest.requestHash,
          baseArtVersionId: generationRequest.baseArtVersionId,
          referenceAssetIds: generationRequest.referenceAssetIds,
          references: generationRequest.references,
          warnings: generationRequest.compiled.warnings
        }
      }
    })
    const body = result.response.body as { jobId: string }
    reply.status(result.response.status).header('location', `/api/v1/jobs/${body.jobId}`)
    return result.response.body
  })

  app.get('/api/v1/generations/:generationId', async (request) =>
    deps.generations.get((request.params as { generationId: string }).generationId)
  )
}
