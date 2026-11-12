import { getErrorDefinition } from '@agent2live/contracts'

export const PROVIDER_ERROR_CODES = [
  'PROVIDER_AUTH_FAILED',
  'PROVIDER_RATE_LIMITED',
  'PROVIDER_TIMEOUT',
  'PROVIDER_UNAVAILABLE',
  'PROVIDER_INVALID_REQUEST',
  'PROVIDER_CONTENT_REJECTED',
  'PROVIDER_INVALID_RESPONSE',
  'PROVIDER_CANCELLED'
] as const

export type ProviderErrorCode = (typeof PROVIDER_ERROR_CODES)[number]

export class ProviderError extends Error {
  readonly httpStatus: number
  readonly retryable: boolean
  readonly retryAfterMs: number | null

  constructor(
    readonly code: ProviderErrorCode,
    message: string,
    options: { retryAfterMs?: number | null } = {}
  ) {
    super(message)
    this.name = 'ProviderError'
    const definition = getErrorDefinition(code)
    this.httpStatus = definition.httpStatus
    this.retryable = definition.retryable
    this.retryAfterMs = options.retryAfterMs ?? null
  }
}

export function providerErrorCodeForHttp(status: number, body: string): ProviderErrorCode {
  if (status === 401 || status === 403) return 'PROVIDER_AUTH_FAILED'
  if (status === 429) return 'PROVIDER_RATE_LIMITED'
  if (status === 408 || status === 504) return 'PROVIDER_TIMEOUT'
  if (status >= 500) return 'PROVIDER_UNAVAILABLE'
  if (status === 400 || status === 422) {
    return /(content|policy|sensitive|moderation|safety)/i.test(body)
      ? 'PROVIDER_CONTENT_REJECTED'
      : 'PROVIDER_INVALID_REQUEST'
  }
  if (status === 404) return 'PROVIDER_INVALID_REQUEST'
  return 'PROVIDER_INVALID_RESPONSE'
}

const MESSAGES: Record<ProviderErrorCode, string> = {
  PROVIDER_AUTH_FAILED: 'provider authentication failed',
  PROVIDER_RATE_LIMITED: 'provider rate limited',
  PROVIDER_TIMEOUT: 'provider request timed out',
  PROVIDER_UNAVAILABLE: 'provider unavailable',
  PROVIDER_INVALID_REQUEST: 'provider rejected the request',
  PROVIDER_CONTENT_REJECTED: 'provider rejected the content',
  PROVIDER_INVALID_RESPONSE: 'provider returned an invalid response',
  PROVIDER_CANCELLED: 'provider request cancelled'
}

export function providerHttpError(
  status: number,
  body: string,
  retryAfterMs: number | null = null
): ProviderError {
  const code = providerErrorCodeForHttp(status, body)
  return new ProviderError(code, MESSAGES[code], { retryAfterMs })
}
