import { getErrorDefinition } from '@agent2live/contracts'
import { ProviderError } from '@agent2live/providers'
import { AppError } from '../errors'

export interface ProviderFailureDetail {
  status: number | null
  providerCode: string | null
}

/** Upstream status and sanitized provider code; the response body is never retained. */
export function providerFailureDetail(error: unknown): ProviderFailureDetail | null {
  if (!(error instanceof ProviderError)) return null
  if (error.providerStatus === null && error.providerCode === null) return null
  return { status: error.providerStatus, providerCode: error.providerCode }
}

/** A readable, body-free failure message for humans. */
export function providerFailureMessage(error: unknown, code: string): string {
  const base = getErrorDefinition(code).defaultDetail
  if (!(error instanceof ProviderError)) return base
  const diagnostics: string[] = []
  if (error.providerStatus !== null) diagnostics.push(`HTTP ${error.providerStatus}`)
  if (error.providerCode !== null) diagnostics.push(error.providerCode)
  return diagnostics.length > 0 ? `${base}（${diagnostics.join(' · ')}）` : base
}

/**
 * Converts a provider failure into a diagnostics-only AppError while preserving
 * the stable code. Returns null for errors that should keep propagating as-is.
 */
export function providerFailureAppError(error: unknown): AppError | null {
  if (!(error instanceof ProviderError)) return null
  return new AppError(error.code, {}, providerFailureMessage(error, error.code))
}
