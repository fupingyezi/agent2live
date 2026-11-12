import { describe, expect, it } from 'vitest'
import { ProviderError, providerErrorCodeForHttp } from '../src/errors'

describe('provider errors', () => {
  it('uses the stable registry for retry semantics', () => {
    const error = new ProviderError('PROVIDER_RATE_LIMITED', 'rate limited')
    expect(error.httpStatus).toBe(429)
    expect(error.retryable).toBe(true)
    expect(error.retryAfterMs).toBeNull()
  })

  it('classifies HTTP failures without echoing bodies', () => {
    expect(providerErrorCodeForHttp(401, 'bad key')).toBe('PROVIDER_AUTH_FAILED')
    expect(providerErrorCodeForHttp(400, '{"error":{"code":"content_policy"}}')).toBe(
      'PROVIDER_CONTENT_REJECTED'
    )
    expect(providerErrorCodeForHttp(400, 'bad shape')).toBe('PROVIDER_INVALID_REQUEST')
    expect(providerErrorCodeForHttp(503, 'down')).toBe('PROVIDER_UNAVAILABLE')
  })
})
