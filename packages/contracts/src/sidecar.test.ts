import { describe, expect, it } from 'vitest'
import { sidecarEndpointFileSchema, sidecarInfoSchema } from './sidecar'

describe('sidecar endpoint contracts', () => {
  it('accepts the endpoint/1 published by the server', () => {
    const value = {
      schemaVersion: 'endpoint/1',
      baseUrl: 'http://127.0.0.1:43123',
      token: 'local-token',
      pid: 321
    }
    expect(sidecarEndpointFileSchema.parse(value)).toEqual(value)
    expect(sidecarInfoSchema.parse(value)).toEqual({
      baseUrl: value.baseUrl,
      token: value.token,
      pid: value.pid
    })
  })

  it.each([
    { ...validEndpoint(), baseUrl: 'http://localhost:43123' },
    { ...validEndpoint(), token: '' },
    { ...validEndpoint(), pid: 0 },
    { ...validEndpoint(), schemaVersion: 'endpoint/2' },
    { ...validEndpoint(), unexpected: true }
  ])('rejects malformed or extended endpoint values', (value) => {
    expect(sidecarEndpointFileSchema.safeParse(value).success).toBe(false)
  })
})

function validEndpoint() {
  return {
    schemaVersion: 'endpoint/1',
    baseUrl: 'http://127.0.0.1:43123',
    token: 'local-token',
    pid: 321
  }
}
