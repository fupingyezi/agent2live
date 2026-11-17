import type { MaterialRole } from '@studio/api'

export type ReferenceStrength = 'loose' | 'balanced' | 'strict'

export interface CharacterReferenceDraft {
  id: string
  file: File
  role: MaterialRole
  strength: ReferenceStrength
  note: string
}

const STRENGTH_WEIGHTS: Record<ReferenceStrength, number> = {
  loose: 0.6,
  balanced: 1,
  strict: 1.4
}

export function strengthToWeight(strength: ReferenceStrength): number {
  return STRENGTH_WEIGHTS[strength]
}

export function weightToStrength(weight: number): ReferenceStrength {
  if (weight <= 0.8) return 'loose'
  if (weight <= 1.2) return 'balanced'
  return 'strict'
}

export function normalizeCharacterReferences(
  references: CharacterReferenceDraft[]
): CharacterReferenceDraft[] {
  return [...references]
}
