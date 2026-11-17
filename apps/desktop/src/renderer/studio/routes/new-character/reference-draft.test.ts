import { describe, expect, test } from 'vitest'
import {
  normalizeCharacterReferences,
  strengthToWeight,
  weightToStrength,
  type CharacterReferenceDraft,
  type ReferenceStrength
} from './reference-draft'

function reference(
  id: string,
  {
    role = 'other',
    strength = 'balanced',
    note = ''
  }: Partial<Pick<CharacterReferenceDraft, 'role' | 'strength' | 'note'>> = {}
): CharacterReferenceDraft {
  return {
    id,
    file: { name: `${id}.png` } as File,
    role,
    strength,
    note
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
  test('preserves the submitted order', () => {
    const references = [reference('style'), reference('identity'), reference('outfit')]
    const normalized = normalizeCharacterReferences(references)
    expect(normalized.map((item) => item.id)).toEqual(['style', 'identity', 'outfit'])
    expect(references.map((item) => item.id)).toEqual(['style', 'identity', 'outfit'])
  })

  test('keeps an empty list empty', () => {
    expect(normalizeCharacterReferences([])).toEqual([])
  })
})
