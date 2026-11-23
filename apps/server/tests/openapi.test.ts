import { describe, expect, it } from 'vitest'
import { createGenerationInputSchema } from '@agent2live/contracts'
import { collectRegisteredRoutes } from '../openapi/coverage'
import { buildResponseSchemas, responseTypeNames, zodSchemaToJsonSchema } from '../openapi/schema-registry'

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
