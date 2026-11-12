import { createHash } from 'node:crypto'

function sortValue(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null) return null
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('non-finite number is not JSON')
    return value
  }
  if (typeof value === 'bigint') throw new TypeError('bigint is not supported')
  if (typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'undefined') return undefined
  if (typeof value === 'function' || typeof value === 'symbol') {
    throw new TypeError('function/symbol is not JSON')
  }
  if (typeof value !== 'object') throw new TypeError('unsupported value')
  if (seen.has(value)) throw new TypeError('cyclic structure')
  seen.add(value)
  try {
    if (Array.isArray(value)) return value.map((item) => sortValue(item, seen))
    const source = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(source).sort()) {
      const item = sortValue(source[key], seen)
      if (item !== undefined) out[key] = item
    }
    return out
  } finally {
    seen.delete(value)
  }
}

export function canonicalJson(value: unknown): string {
  const normalized = sortValue(value, new WeakSet())
  if (normalized === undefined) throw new TypeError('top-level undefined is not JSON')
  return JSON.stringify(normalized)
}

export function sha256Hex(input: string | Uint8Array): string {
  return createHash('sha256').update(input).digest('hex')
}

export function hashCanonical(value: unknown): string {
  return sha256Hex(canonicalJson(value))
}
