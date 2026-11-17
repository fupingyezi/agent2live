import { describe, expect, it } from 'vitest'
import { ProviderError, providerErrorCodeForHttp, providerHttpError } from '../src/errors'

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

  it('keeps the upstream status and a sanitized provider code without the body message', () => {
    const error = providerHttpError(
      404,
      JSON.stringify({
        error: {
          code: 'InvalidEndpointOrModel.NotFound',
          message: 'upstream body must not leak',
          type: 'invalid_request_error'
        }
      })
    )
    expect(error.code).toBe('PROVIDER_INVALID_REQUEST')
    expect(error.message).toBe('provider rejected the request')
    expect(error.providerStatus).toBe(404)
    expect(error.providerCode).toBe('InvalidEndpointOrModel.NotFound')
    expect(JSON.stringify(error)).not.toContain('upstream body must not leak')
  })

  it('falls back to the provider error type and drops unsafe codes', () => {
    const typed = providerHttpError(503, JSON.stringify({ error: { type: 'InternalServiceError' } }))
    expect(typed.providerStatus).toBe(503)
    expect(typed.providerCode).toBe('InternalServiceError')

    const unsafe = providerHttpError(
      500,
      JSON.stringify({ error: { code: 'bad code with spaces / secret' } })
    )
    expect(unsafe.providerStatus).toBe(500)
    expect(unsafe.providerCode).toBeNull()
  })
})
