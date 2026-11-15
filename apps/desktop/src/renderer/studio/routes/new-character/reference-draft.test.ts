import { describe, expect, test } from 'vitest'
import {
  normalizeCharacterReferences,
  setPrimaryReference,
  strengthToWeight,
  weightToStrength,
  type CharacterReferenceDraft,
  type ReferenceStrength
} from './reference-draft'

function reference(
  id: string,
  {
    isPrimary = false,
    role = 'other',
    strength = 'balanced',
    note = ''
  }: Partial<Pick<CharacterReferenceDraft, 'isPrimary' | 'role' | 'strength' | 'note'>> = {}
): CharacterReferenceDraft {
  return {
    id,
    file: { name: `${id}.png` } as File,
    role,
    strength,
    note,
    isPrimary
  }
}

describe('reference strength', () => {
  test.each([
    ['loose', 0.6],
    ['balanced', 1],
    ['strict', 1.4]
  ] satisfies Array<[ReferenceStrength, number]>)('maps %s to %s', (strength, weight) => {
    expect(strengthToWeight(strength)).toBe(weight)
  })

  test.each([
    [0.6, 'loose'],
    [1, 'balanced'],
    [1.4, 'strict']
  ] satisfies Array<[number, ReferenceStrength]>)('maps weight %s to %s', (weight, strength) => {
    expect(weightToStrength(weight)).toBe(strength)
  })
})

describe('normalizeCharacterReferences', () => {
  test('leaves an empty list empty', () => {
    expect(normalizeCharacterReferences([])).toEqual([])
  })

  test('makes the first reference primary when a primary was deleted', () => {
    const normalized = normalizeCharacterReferences([reference('style'), reference('outfit')])

    expect(normalized.map((item) => item.id)).toEqual(['style', 'outfit'])
    expect(normalized.map((item) => item.isPrimary)).toEqual([true, false])
  })

  test('setting a new primary clears the old primary', () => {
    const references = [reference('identity', { isPrimary: true }), reference('style')]

    const normalized = setPrimaryReference(references, 'style')

    expect(normalized.map((item) => item.id)).toEqual(['style', 'identity'])
    expect(normalized.filter((item) => item.isPrimary)).toHaveLength(1)
    expect(normalized[0]?.isPrimary).toBe(true)
  })

  test('moves the existing primary to the front without mutating the input', () => {
    const references = [reference('style'), reference('identity', { isPrimary: true })]

    const normalized = normalizeCharacterReferences(references)

    expect(normalized.map((item) => item.id)).toEqual(['identity', 'style'])
    expect(normalized.filter((item) => item.isPrimary)).toHaveLength(1)
    expect(references.map((item) => item.id)).toEqual(['style', 'identity'])
  })

  test('keeps exactly one primary when multiple references are marked', () => {
    const normalized = normalizeCharacterReferences([
      reference('identity', { isPrimary: true }),
      reference('style', { isPrimary: true })
    ])

    expect(normalized.map((item) => [item.id, item.isPrimary])).toEqual([
      ['identity', true],
      ['style', false]
    ])
  })
})
