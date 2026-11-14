import type { FastifyInstance, FastifyRequest } from 'fastify'
import { updateArtProjectInputSchema } from '@agent2live/contracts'
import { etagFor, parseIfMatch } from '../http/conditional'
import type { ProjectTreeService } from '../services/project-tree'
import type { ProjectService } from '../services/projects'
import { idsOf } from './helpers'

export interface ProjectRouteDeps {
  projects: ProjectService
  projectTree: ProjectTreeService
}

function ifMatch(request: FastifyRequest): number {
  const value = request.headers['if-match']
  return parseIfMatch(Array.isArray(value) ? value[0] : value)
}

export function registerProjectRoutes(app: FastifyInstance, deps: ProjectRouteDeps): void {
  app.get('/api/v1/art-projects/:id', async (request) => {
    return deps.projects.get((request.params as { id: string }).id)
  })

  app.patch('/api/v1/art-projects/:id', async (request, reply) => {
    const id = (request.params as { id: string }).id
    const input = updateArtProjectInputSchema.parse(request.body)
    const dto = deps.projects.update(id, input, ifMatch(request), idsOf(request))
    reply.header('etag', etagFor(dto.rowVersion))
    return dto
  })

  app.delete('/api/v1/art-projects/:id', async (request, reply) => {
    const id = (request.params as { id: string }).id
    deps.projects.softDelete(id, ifMatch(request), idsOf(request))
    return reply.status(204).send()
  })

  app.get('/api/v1/art-projects/:id/tree', async (request) => {
    return deps.projectTree.get((request.params as { id: string }).id)
  })
}
