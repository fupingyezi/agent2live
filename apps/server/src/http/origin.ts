const LOCAL_ORIGIN = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/

/** Single allowlist shared by @fastify/cors and responses that bypass its hooks. */
export function isAllowedCorsOrigin(origin: string | undefined): boolean {
  return !origin || origin === 'null' || LOCAL_ORIGIN.test(origin)
}

/** CORS headers for hijacked responses, reflecting only allowlisted origins. */
export function corsHeadersFor(origin: string | undefined): Record<string, string> {
  const headers: Record<string, string> = { vary: 'Origin' }
  if (origin && isAllowedCorsOrigin(origin)) headers['access-control-allow-origin'] = origin
  return headers
}
