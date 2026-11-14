import { describe, expect, it } from 'vitest'
import {
  ART_VERSION_REFERENCE_ROLES,
  artVersionReferenceSetSchema,
  reviseArtVersionReferencesInputSchema
} from './art-reference'

const ref = (assetDigit: string, sortOrder: number, isPrimary = false) => ({
  assetId: `ast_01J0000000000000000000000${assetDigit}`,
  role: 'identity_reference' as const,
  note: '',
  weight: 1,
  sortOrder,
  isPrimary,
  locked: false
})

describe('ArtVersion reference set', () => {
  it('accepts one primary at order 0 and continuous auxiliary orders', () => {
    const parsed = artVersionReferenceSetSchema.parse([ref('0', 0, true), ref('1', 1), ref('2', 2)])
    expect(parsed.map((item) => item.sortOrder)).toEqual([0, 1, 2])
  })

  it('rejects zero or multiple primaries', () => {
    expect(() => artVersionReferenceSetSchema.parse([ref('0', 0)])).toThrow(/primary/i)
    expect(() => artVersionReferenceSetSchema.parse([ref('0', 0, true), ref('1', 1, true)])).toThrow(
      /primary/i
    )
  })

  it('requires primary order 0 and auxiliary orders 1..N-1', () => {
    expect(() => artVersionReferenceSetSchema.parse([ref('0', 1, true)])).toThrow(/order/i)
    expect(() => artVersionReferenceSetSchema.parse([ref('0', 0, true), ref('1', 2)])).toThrow(/order/i)
    expect(() => artVersionReferenceSetSchema.parse([ref('0', 0, true), ref('1', 1), ref('2', 1)])).toThrow(
      /order/i
    )
  })

  it('rejects duplicate assets and more than 14 references', () => {
    expect(() => artVersionReferenceSetSchema.parse([ref('0', 0, true), ref('0', 1)])).toThrow(/duplicate/i)
    const tooMany = Array.from({ length: 15 }, (_, index) =>
      ref(index.toString(36).slice(-1), index, index === 0)
    )
    expect(() => artVersionReferenceSetSchema.parse(tooMany)).toThrow()
  })

  it('rejects unknown roles, bad weights, and extra fields', () => {
    expect(() => artVersionReferenceSetSchema.parse([{ ...ref('0', 0, true), role: 'face' }])).toThrow()
    expect(() => artVersionReferenceSetSchema.parse([{ ...ref('0', 0, true), weight: 2.1 }])).toThrow()
    expect(() =>
      artVersionReferenceSetSchema.parse([{ ...ref('0', 0, true), assetPath: '/tmp/a.png' }])
    ).toThrow()
    expect(ART_VERSION_REFERENCE_ROLES).toContain('identity_reference')
    expect(ART_VERSION_REFERENCE_ROLES).toContain('other')
  })

  it('validates the full replacement command', () => {
    const parsed = reviseArtVersionReferencesInputSchema.parse({
      reason: 'switch_primary',
      references: [ref('0', 0, true), ref('1', 1)]
    })
    expect(parsed.reason).toBe('switch_primary')
  })
})
