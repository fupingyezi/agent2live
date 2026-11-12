import { describe, expect, it } from 'vitest'
import { canonicalJson, hashCanonical, sha256Hex } from './hash'

describe('canonicalJson', () => {
  it('sorts object keys recursively but preserves array order', () => {
    const a = { z: 1, a: { y: 2, b: [3, { d: 4, c: 5 }] } }
    const b = { a: { b: [3, { c: 5, d: 4 }], y: 2 }, z: 1 }
    expect(canonicalJson(a)).toBe(canonicalJson(b))
    expect(canonicalJson([2, 1])).not.toBe(canonicalJson([1, 2]))
  })

  it('omits undefined object fields and rejects non-JSON values', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}')
    expect(() => canonicalJson({ n: Number.NaN })).toThrow(/finite/)
    expect(() => canonicalJson({ big: 1n })).toThrow(/bigint/i)
  })

  it('rejects cyclic structures', () => {
    const value: Record<string, unknown> = {}
    value.self = value
    expect(() => canonicalJson(value)).toThrow(/cyclic/i)
  })
})

describe('sha256', () => {
  it('returns stable 64-char lowercase hex', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(hashCanonical({ b: 1, a: 2 })).toBe(hashCanonical({ a: 2, b: 1 }))
    expect(hashCanonical({ a: 1 })).toMatch(/^[0-9a-f]{64}$/)
  })
})
