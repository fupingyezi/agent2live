import type { FastifyInstance, FastifyRequest } from 'fastify'
import {
  createArtProjectInputSchema,
  createCharacterBriefVersionInputSchema,
  createCharacterInputSchema,
  updateCharacterInputSchema
} from '@agent2live/contracts'
import { etagFor, parseIfMatch } from '../http/conditional'
import type { CharacterBriefService } from '../services/character-briefs'
import type { CharacterService } from '../services/characters'
import type { ProjectService } from '../services/projects'
import { idsOf } from './helpers'

export interface CharacterRouteDeps {
  characters: CharacterService
  characterBriefs: CharacterBriefService
  projects: ProjectService
}

function ifMatch(request: FastifyRequest): number {
  const value = request.headers['if-match']
  return parseIfMatch(Array.isArray(value) ? value[0] : value)
}

export function registerCharacterRoutes(app: FastifyInstance, deps: CharacterRouteDeps): void {
  app.get('/api/v1/characters', async () => deps.characters.list())

  app.get('/api/v1/characters/:id', async (request) => {
    return deps.characters.get((request.params as { id: string }).id)
  })

  app.post('/api/v1/characters', async (request, reply) => {
    const input = createCharacterInputSchema.parse(request.body)
    const dto = deps.characters.create(input, idsOf(request))
    reply
      .status(201)
      .header('location', `/api/v1/characters/${dto.id}`)
      .header('etag', etagFor(dto.rowVersion))
    return dto
  })

  app.patch('/api/v1/characters/:id', async (request, reply) => {
    const id = (request.params as { id: string }).id
    const input = updateCharacterInputSchema.parse(request.body)
    const dto = deps.characters.update(id, input, ifMatch(request), idsOf(request))
    reply.header('etag', etagFor(dto.rowVersion))
    return dto
  })

  app.delete('/api/v1/characters/:id', async (request, reply) => {
    const id = (request.params as { id: string }).id
    deps.characters.softDelete(id, ifMatch(request), idsOf(request))
    return reply.status(204).send()
  })

  app.get('/api/v1/characters/:id/brief-versions', async (request) => {
    const id = (request.params as { id: string }).id
    return deps.characterBriefs.list(id)
  })

  app.post('/api/v1/characters/:id/brief-versions', async (request, reply) => {
    const characterId = (request.params as { id: string }).id
    const input = createCharacterBriefVersionInputSchema.parse(request.body)
    const version = deps.characterBriefs.create(characterId, input, idsOf(request))
    const character = deps.characters.get(characterId)
    reply
      .status(201)
      .header('location', `/api/v1/characters/${characterId}/brief-versions/${version.id}`)
      .header('etag', etagFor(character.rowVersion))
    return version
  })

  app.post('/api/v1/characters/:id/art-projects', async (request, reply) => {
    const characterId = (request.params as { id: string }).id
    const input = createArtProjectInputSchema.parse(request.body)
    const dto = deps.projects.create(characterId, input, idsOf(request))
    reply
      .status(201)
      .header('location', `/api/v1/art-projects/${dto.id}`)
      .header('etag', etagFor(dto.rowVersion))
    return dto
  })
}
