import { randomBytes, timingSafeEqual } from 'node:crypto'

export function randomToken(): string {
  return randomBytes(32).toString('base64url')
}

export function tokenMatches(expected: string, supplied: string): boolean {
  const a = Buffer.from(expected)
  const b = Buffer.from(supplied)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export function bearerToken(header: string | undefined): string | null {
  if (!header) return null
  const match = /^Bearer ([A-Za-z0-9_-]+)$/.exec(header)
  return match?.[1] ?? null
}
