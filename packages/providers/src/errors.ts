import { getErrorDefinition } from '@agent2live/contracts'

export const PROVIDER_ERROR_CODES = [
  'PROVIDER_AUTH_FAILED',
  'PROVIDER_RATE_LIMITED',
  'PROVIDER_TIMEOUT',
  'PROVIDER_UNAVAILABLE',
  'PROVIDER_INVALID_REQUEST',
  'PROVIDER_CONTENT_REJECTED',
  'PROVIDER_INVALID_RESPONSE',
  'PROVIDER_CANCELLED',
  'PROVIDER_MODELS_UNSUPPORTED'
] as const

export type ProviderErrorCode = (typeof PROVIDER_ERROR_CODES)[number]

export interface ProviderErrorOptions {
  retryAfterMs?: number | null
  /** Upstream HTTP status, kept for diagnostics only. Never derived from our own registry. */
  providerStatus?: number | null
  /** Sanitized upstream error code (e.g. Ark's error.code). Never the response body. */
  providerCode?: string | null
}

const PROVIDER_CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/

/** Only short identifier-shaped codes are safe to persist or display. */
export function safeProviderCode(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return PROVIDER_CODE_PATTERN.test(trimmed) ? trimmed : null
}

/**
 * Extract a diagnostic code from a provider error body without retaining the body.
 * Ark returns `{ error: { code, message } }`; other compatible APIs use `error.type`.
 */
export function providerCodeFromBody(body: string): string | null {
  let value: unknown
  try {
    value = JSON.parse(body)
  } catch {
    return null
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const error = (value as { error?: unknown }).error
  if (error && typeof error === 'object' && !Array.isArray(error)) {
    const typed = error as { code?: unknown; type?: unknown }
    return safeProviderCode(typed.code) ?? safeProviderCode(typed.type)
  }
  return safeProviderCode((value as { code?: unknown }).code)
}

export class ProviderError extends Error {
  readonly httpStatus: number
  readonly retryable: boolean
  readonly retryAfterMs: number | null
  readonly providerStatus: number | null
  readonly providerCode: string | null

  constructor(
    readonly code: ProviderErrorCode,
    message: string,
    options: ProviderErrorOptions = {}
  ) {
    super(message)
    this.name = 'ProviderError'
    const definition = getErrorDefinition(code)
    this.httpStatus = definition.httpStatus
    this.retryable = definition.retryable
    this.retryAfterMs = options.retryAfterMs ?? null
    this.providerStatus = options.providerStatus ?? null
    this.providerCode = safeProviderCode(options.providerCode)
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
  PROVIDER_CANCELLED: 'provider request cancelled',
  PROVIDER_MODELS_UNSUPPORTED: 'provider does not support model discovery'
}

export function providerHttpError(
  status: number,
  body: string,
  retryAfterMs: number | null = null
): ProviderError {
  const code = providerErrorCodeForHttp(status, body)
  return new ProviderError(code, MESSAGES[code], {
    retryAfterMs,
    providerStatus: status,
    providerCode: providerCodeFromBody(body)
  })
}
