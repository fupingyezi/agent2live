import { describe, expect, it } from 'vitest'
import { buildApp } from '../app'
import { randomToken } from '../auth'

describe('local API auth', () => {
  const token = randomToken()

  it('rejects missing, wrong, and query-string tokens with problem+json', async () => {
    const app = buildApp({ token })
    try {
      const missing = await app.inject({ method: 'GET', url: '/health' })
      expect(missing.statusCode).toBe(401)
      expect(missing.headers['content-type']).toContain('application/problem+json')
      expect(missing.json().error.code).toBe('AUTH_LOCAL_TOKEN_INVALID')

      const wrong = await app.inject({
        method: 'GET',
        url: '/health',
        headers: { authorization: 'Bearer wrong' }
      })
      expect(wrong.statusCode).toBe(401)

      const query = await app.inject({ method: 'GET', url: `/health?token=${token}` })
      expect(query.statusCode).toBe(401)
    } finally {
      await app.close()
    }
  })

  it('accepts the exact bearer token and sets request/trace headers', async () => {
    const app = buildApp({ token })
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/health',
        headers: { authorization: `Bearer ${token}` }
      })
      expect(res.statusCode).toBe(200)
      expect(res.json().schemaVersion).toBe('health/1')
      expect(res.headers['x-request-id']).toBeTruthy()
      expect(res.headers['x-trace-id']).toBeTruthy()
    } finally {
      await app.close()
    }
  })

  it('maps an unknown route to RESOURCE_NOT_FOUND with the same envelope', async () => {
    const app = buildApp({ token })
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/nope',
        headers: { authorization: `Bearer ${token}` }
      })
      expect(res.statusCode).toBe(404)
      expect(res.json().error.code).toBe('RESOURCE_NOT_FOUND')
    } finally {
      await app.close()
    }
  })
})
