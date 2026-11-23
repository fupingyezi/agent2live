import { describe, expect, it } from 'vitest'
import { localServiceEndpointFileSchema, localServiceInfoSchema } from './local-service'

describe('local service endpoint contracts', () => {
  it('accepts the endpoint/1 published by the server', () => {
    const value = {
      schemaVersion: 'endpoint/1',
      baseUrl: 'http://127.0.0.1:43123',
      token: 'secret-token-0123456789abcdefghijkl',
      pid: 321,
      startedAt: '2026-11-13T00:00:00.000Z'
    }
    expect(localServiceEndpointFileSchema.parse(value)).toEqual(value)
    expect(localServiceInfoSchema.parse(value)).toEqual({
      baseUrl: value.baseUrl,
      token: value.token,
      pid: value.pid
    })
  })

  it.each([
    { ...validEndpoint(), baseUrl: 'http://localhost:43123' },
    { ...validEndpoint(), token: 'local-token' },
    { ...validEndpoint(), pid: 0 },
    { ...validEndpoint(), schemaVersion: 'endpoint/2' },
    { ...validEndpoint(), unexpected: true },
    { ...validEndpoint(), startedAt: '' },
    endpointWithoutStartedAt()
  ])('rejects malformed or extended endpoint values', (value) => {
    expect(localServiceEndpointFileSchema.safeParse(value).success).toBe(false)
  })
})

function validEndpoint() {
  return {
    schemaVersion: 'endpoint/1',
    baseUrl: 'http://127.0.0.1:43123',
    token: 'secret-token-0123456789abcdefghijkl',
    pid: 321,
    startedAt: '2026-11-13T00:00:00.000Z'
  }
}

function endpointWithoutStartedAt() {
  const { startedAt: _startedAt, ...rest } = validEndpoint()
  return rest
}
