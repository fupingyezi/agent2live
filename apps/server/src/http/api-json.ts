export const API_TIMESTAMP_KEYS: ReadonlySet<string> = new Set([
  'createdAt',
  'updatedAt',
  'deletedAt',
  'completedAt',
  'startedAt',
  'finishedAt',
  'cancelRequestedAt',
  'nextAttemptAt',
  'detachedAt',
  'expiresAt',
  'acceptedAt',
  'activatedAt',
  'appliedAt',
  'resolvedAt',
  'discardedAt',
  'publishedAt',
  'lastSeenAt',
  'modelsRefreshedAt'
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
}

export function serializeApiTimestamps(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(serializeApiTimestamps)
  if (!isRecord(value)) return value
  if (Buffer.isBuffer(value)) return value

  const result: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) {
    if (API_TIMESTAMP_KEYS.has(key) && typeof child === 'number' && Number.isFinite(child)) {
      result[key] = new Date(child).toISOString()
    } else {
      result[key] = serializeApiTimestamps(child)
    }
  }
  return result
}

export function apiJsonSerializer(payload: unknown): string {
  return JSON.stringify(serializeApiTimestamps(payload))
}
