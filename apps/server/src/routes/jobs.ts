import type { FastifyInstance } from 'fastify'
import { AppError } from '../errors'
import type { JobEngine } from '../jobs/engine'

export function registerJobRoutes(app: FastifyInstance, jobs: JobEngine): void {
  app.get('/api/v1/jobs/:id', async (request) => {
    const id = (request.params as { id: string }).id
    return jobs.get(id)
  })

  app.get('/api/v1/jobs/:id/events', async (request) => {
    const id = (request.params as { id: string }).id
    jobs.get(id)
    const raw = (request.query as { after?: string }).after ?? '0'
    const after = Number(raw)
    if (!Number.isSafeInteger(after) || after < 0) {
      throw new AppError('REQUEST_INVALID', { reason: 'after must be a non-negative integer' })
    }
    return { items: jobs.listJobEvents(id, after) }
  })

  app.post('/api/v1/jobs/:id/cancel', async (request) => {
    const id = (request.params as { id: string }).id
    return jobs.cancel(id)
  })
}
