import { AppError } from '../errors'

export function parseIfMatch(value: string | undefined): number {
  if (!value) throw new AppError('PRECONDITION_REQUIRED', { header: 'If-Match' })
  const match = /^(?:W\/)?"?(\d+)"?$/.exec(value.trim())
  if (!match) throw new AppError('REQUEST_INVALID', { reason: 'invalid If-Match header' })
  const version = Number(match[1])
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new AppError('REQUEST_INVALID', { reason: 'invalid If-Match header' })
  }
  return version
}

export function requireIfMatch(value: string | undefined, actual: number): number {
  const expected = parseIfMatch(value)
  if (expected !== actual) throw new AppError('ROW_VERSION_CONFLICT', { expected, actual })
  return expected
}

export function parseActiveMatch(value: string | undefined): string | null {
  if (!value) throw new AppError('PRECONDITION_REQUIRED', { header: 'If-Match' })
  const trimmed = value.trim().replace(/^W\//, '').replace(/^"|"$/g, '')
  if (trimmed === 'none') return null
  if (!/^[a-z]+_[0-9A-HJKMNP-TV-Z]{26}$/.test(trimmed)) {
    throw new AppError('REQUEST_INVALID', { reason: 'invalid If-Match header' })
  }
  return trimmed
}

export function assertActiveVersion(expected: string | null, actual: string | null): void {
  if (expected !== actual) {
    throw new AppError('ART_ACTIVE_VERSION_CHANGED', { expected, actual })
  }
}

export function etagFor(rowVersion: number): string {
  return `"${rowVersion}"`
}
