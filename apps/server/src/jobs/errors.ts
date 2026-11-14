import { ProviderError } from '@agent2live/providers'
import { getErrorDefinition } from '@agent2live/contracts'
import { AppError } from '../errors'

export interface NormalizedJobError {
  code: string
  retryable: boolean
}

const RETRYABLE_PROVIDER = new Set(['PROVIDER_RATE_LIMITED', 'PROVIDER_TIMEOUT', 'PROVIDER_UNAVAILABLE'])

export function normalizeJobError(error: unknown): NormalizedJobError {
  if (error instanceof ProviderError) {
    return { code: error.code, retryable: RETRYABLE_PROVIDER.has(error.code) }
  }
  if (error instanceof AppError) {
    let retryable = false
    try {
      retryable = getErrorDefinition(error.code).retryable
    } catch {
      retryable = false
    }
    return { code: error.code, retryable }
  }
  if ((error as { name?: string }).name === 'AbortError') {
    return { code: 'JOB_ABORTED', retryable: false }
  }
  return { code: 'SYS_INTERNAL', retryable: true }
}

export function safeErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : 'unknown error'
  return raw
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, '[REDACTED]')
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [REDACTED]')
    .replace(/\b(api[_-]?key|authorization|secret)\s*[=:]\s*\S+/gi, '$1=[REDACTED]')
    .slice(0, 500)
}
