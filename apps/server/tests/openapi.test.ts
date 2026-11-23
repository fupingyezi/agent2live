import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createGenerationInputSchema } from '@agent2live/contracts'
import { assertManifestCoverage, collectRegisteredRoutes } from '../openapi/coverage'
import { buildOpenApiDocument, OPENAPI_TITLE } from '../openapi/generate'
import { manifest } from '../openapi/manifest'
import { OPENAPI_OUTPUT, renderOpenApi } from '../openapi/pipeline'
import { buildResponseSchemas, responseTypeNames, zodSchemaToJsonSchema } from '../openapi/schema-registry'
import { validateManifest, validateOpenApi } from '../openapi/validate'

describe('openapi route coverage', () => {
  it('collects every registered route exactly once without HEAD twins', async () => {
    const routes = await collectRegisteredRoutes()
    const keys = routes.map((route) => `${route.method} ${route.path}`).sort()

    expect(keys).toHaveLength(62)
    expect(keys).toContain('GET /health')
    expect(keys).toContain('GET /api/v1/events')
    expect(routes.some((route) => route.method === 'HEAD')).toBe(false)
  })
})

describe('openapi schema registry', () => {
  it('converts request Zod schemas to OpenAPI-compatible JSON Schema', () => {
    const schema = zodSchemaToJsonSchema(createGenerationInputSchema)
    expect(schema).toMatchObject({ type: 'object' })
    expect(schema).not.toHaveProperty('$schema')
    expect(schema.properties).toHaveProperty('promptVersionId')
  })

  it('generates every declared response type and patches Zod-inferred fields', () => {
    const schemas = buildResponseSchemas() as Record<string, any>
    for (const name of responseTypeNames) expect(schemas[name]).toBeDefined()
    expect(schemas.PromptDraftDto.properties.state).toMatchObject({
      $ref: expect.stringMatching(/PromptSpecV2$/)
    })
    expect(schemas.PromptSpecV2.properties.blocks).toBeDefined()
    expect(schemas.ProviderConnectionDto.properties.models.items).toMatchObject({
      $ref: expect.stringMatching(/ProviderModelProfile$/)
    })
    expect(schemas.ProblemDetails).toBeDefined()
  })
})

describe('openapi wire timestamps', () => {
  it('converts JSON timestamp fields to date-time but leaves SSE and numbers alone', () => {
    const schemas = buildResponseSchemas() as Record<string, any>
    expect(schemas.ArtProjectDto.properties.createdAt).toMatchObject({
      type: 'string',
      format: 'date-time'
    })
    expect(schemas.ArtProjectDto.properties.deletedAt).toMatchObject({
      type: 'string',
      format: 'date-time',
      nullable: true
    })
    expect(schemas.ArtProjectDto.properties.rowVersion).toMatchObject({ type: 'number' })
    expect(schemas.ProviderProbeDto.properties.checkedAt).toMatchObject({ type: 'number' })
    expect(schemas.SseEvent.properties.createdAt).toMatchObject({ type: 'number' })
    expect(JSON.stringify(schemas)).not.toContain('#/definitions/')
  })
})

describe('openapi manifest groups', () => {
  it('covers system, character, project, and fork routes', () => {
    const group = manifest.filter((operation) =>
      ['system', 'characters', 'projects'].includes(operation.group)
    )
    expect(group).toHaveLength(18)
    expect(group.map((operation) => `${operation.method} ${operation.path}`)).toEqual(
      expect.arrayContaining([
        'GET /health',
        'GET /api/v1/events',
        'GET /api/v1/characters',
        'POST /api/v1/characters',
        'GET /api/v1/art-projects/:id',
        'GET /api/v1/art-projects/tree',
        'POST /api/v1/prompt-versions/:versionId/forks',
        'PATCH /api/v1/art-projects/:id/fork-link'
      ])
    )
  })

  it('covers all prompt routes', () => {
    const group = manifest.filter((operation) => operation.group === 'prompt')
    expect(group).toHaveLength(18)
    expect(group.map((operation) => `${operation.method} ${operation.path}`)).toEqual(
      expect.arrayContaining([
        'POST /api/v1/art-projects/:id/prompt-inputs',
        'POST /api/v1/art-projects/:id/prompt-drafts/:draftId/commit',
        'POST /api/v1/art-projects/:id/prompt-reverse',
        'POST /api/v1/prompt-versions/:versionId/suggestions',
        'POST /api/v1/prompt-suggestions/:suggestionId/reject'
      ])
    )
  })

  it('covers generations, art versions, and jobs', () => {
    const group = manifest.filter((operation) => operation.group === 'generations')
    expect(group).toHaveLength(12)
    expect(group.map((operation) => `${operation.method} ${operation.path}`)).toEqual(
      expect.arrayContaining([
        'POST /api/v1/art-projects/:id/generations',
        'GET /api/v1/generations/:generationId',
        'POST /api/v1/generation-candidates/:candidateId/accept',
        'GET /api/v1/jobs/:id/events',
        'POST /api/v1/jobs/:id/cancel'
      ])
    )
  })

  it('covers providers, assets, and backups', () => {
    const group = manifest.filter((operation) => operation.group === 'resources')
    expect(group).toHaveLength(14)
    expect(group.map((operation) => `${operation.method} ${operation.path}`)).toEqual(
      expect.arrayContaining([
        'POST /api/v1/assets',
        'GET /api/v1/assets/:id/content',
        'POST /api/v1/providers/:id/test',
        'GET /api/v1/backups/:backupId/download'
      ])
    )
  })
})

describe('openapi document', () => {
  it('generates and validates all operations', async () => {
    validateManifest(manifest)
    const doc = buildOpenApiDocument() as any
    expect(doc.info.title).toBe(OPENAPI_TITLE)
    expect(doc.security).toEqual([{ bearerAuth: [] }])
    const methods = new Set(['get', 'post', 'patch', 'delete'])
    const operations = Object.values(doc.paths as Record<string, Record<string, unknown>>).flatMap((path) =>
      Object.entries(path).filter(([method]) => methods.has(method))
    )
    expect(operations).toHaveLength(62)
    expect(
      new Set(operations.map(([, operation]) => (operation as { operationId: string }).operationId)).size
    ).toBe(62)
    await expect(validateOpenApi(doc)).resolves.toBeUndefined()
  })

  it('matches the real Fastify route set', async () => {
    const routes = await collectRegisteredRoutes()
    expect(() => assertManifestCoverage(manifest, routes)).not.toThrow()
  })

  it('documents multipart, binary, and SSE content', () => {
    const doc = buildOpenApiDocument() as any
    expect(doc.paths['/api/v1/assets'].post.requestBody.content['multipart/form-data']).toBeDefined()
    expect(
      doc.paths['/api/v1/art-projects/{id}/prompt-inputs'].post.requestBody.content['multipart/form-data']
        .schema.properties.metadata
    ).toBeDefined()
    expect(
      doc.paths['/api/v1/assets/{id}/content'].get.responses['200'].content['image/png'].schema.format
    ).toBe('binary')
    expect(doc.paths['/api/v1/events'].get.responses['200'].content['text/event-stream']).toBeDefined()
  })

  it('rejects an invalid OpenAPI document', async () => {
    await expect(validateOpenApi({ openapi: '3.0.3' })).rejects.toThrow()
  })

  it('committed OpenAPI file matches the generator', async () => {
    expect(readFileSync(OPENAPI_OUTPUT, 'utf8')).toBe(await renderOpenApi())
  })
})
