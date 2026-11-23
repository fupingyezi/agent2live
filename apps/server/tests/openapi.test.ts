import { describe, expect, it } from 'vitest'
import { collectRegisteredRoutes } from '../openapi/coverage'

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
