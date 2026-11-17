import { describe, expect, it } from 'vitest'
import { promptReferenceSetSchema } from './prompt-reference'

const ref = (assetId: string) => ({
  assetId,
  role: 'identity_reference' as const,
  note: '',
  weight: 1,
  locked: false
})

describe('prompt reference set', () => {
  it('keeps reference array order and exposes no primary field', () => {
    const parsed = promptReferenceSetSchema.parse([
      ref('ast_01J00000000000000000000001'),
      ref('ast_01J00000000000000000000000')
    ])
    expect(parsed.map((item) => item.assetId)).toEqual([
      'ast_01J00000000000000000000001',
      'ast_01J00000000000000000000000'
    ])
    expect('isPrimary' in parsed[0]!).toBe(false)
  })

  it('allows an empty reference set for text-to-image', () => {
    expect(promptReferenceSetSchema.parse([])).toEqual([])
  })

  it('rejects duplicate assets and more than 14 references', () => {
    expect(() =>
      promptReferenceSetSchema.parse([
        ref('ast_01J00000000000000000000000'),
        ref('ast_01J00000000000000000000000')
      ])
    ).toThrow(/duplicate/i)
    const tooMany = Array.from({ length: 15 }, (_, index) => ref(`ast_01J${String(index).padStart(23, '0')}`))
    expect(() => promptReferenceSetSchema.parse(tooMany)).toThrow()
  })

  it('rejects unknown roles, bad weights, and extra fields', () => {
    expect(() =>
      promptReferenceSetSchema.parse([{ ...ref('ast_01J00000000000000000000000'), role: 'primary' }])
    ).toThrow()
    expect(() =>
      promptReferenceSetSchema.parse([{ ...ref('ast_01J00000000000000000000000'), weight: 2.1 }])
    ).toThrow()
    expect(() =>
      promptReferenceSetSchema.parse([{ ...ref('ast_01J00000000000000000000000'), isPrimary: true }])
    ).toThrow()
  })
})
