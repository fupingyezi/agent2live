import { describe, expect, it } from 'vitest'
import {
  clampGenerationCount,
  generationCountOptions,
  MAX_GENERATION_COUNT
} from './generation-params'

describe('generationCountOptions', () => {
  it('keeps the standard chips and clamps to the provider max', () => {
    expect(generationCountOptions(4)).toEqual([1, 2, 4])
    expect(generationCountOptions(8)).toEqual([1, 2, 4, 6, 8])
    expect(generationCountOptions(15)).toEqual([1, 2, 4, 6, 8])
    expect(generationCountOptions(1)).toEqual([1])
  })

  it('includes a non-standard provider max as a chip', () => {
    expect(generationCountOptions(3)).toEqual([1, 2, 3])
    expect(generationCountOptions(5)).toEqual([1, 2, 4, 5])
  })

  it('preserves a legacy non-standard prefilled count without snapping it', () => {
    expect(generationCountOptions(4, 3)).toEqual([1, 2, 3, 4])
    expect(generationCountOptions(8, 5)).toEqual([1, 2, 4, 5, 6, 8])
    expect(generationCountOptions(8, 7)).toEqual([1, 2, 4, 6, 7, 8])
    expect(generationCountOptions(3, 3)).toEqual([1, 2, 3])
  })

  it('does not add a prefilled count that is over the effective max', () => {
    expect(generationCountOptions(4, 5)).toEqual([1, 2, 4])
    expect(generationCountOptions(8, 12)).toEqual([1, 2, 4, 6, 8])
    expect(generationCountOptions(4, 0)).toEqual([1, 2, 4])
  })
})

describe('clampGenerationCount', () => {
  it('keeps an exact prefilled count instead of snapping to a chip', () => {
    expect(clampGenerationCount(3, 4)).toBe(3)
    expect(clampGenerationCount(5, 8)).toBe(5)
    expect(clampGenerationCount(7, 8)).toBe(7)
  })

  it('only clamps down to the provider or API max', () => {
    expect(clampGenerationCount(5, 4)).toBe(4)
    expect(clampGenerationCount(12, 15)).toBe(MAX_GENERATION_COUNT)
    expect(clampGenerationCount(3, 2)).toBe(2)
  })

  it('defaults to 4 and never goes below 1', () => {
    expect(clampGenerationCount(null, 4)).toBe(4)
    expect(clampGenerationCount(undefined, 8)).toBe(4)
    expect(clampGenerationCount(0, 4)).toBe(1)
    expect(clampGenerationCount(3, 0)).toBe(1)
  })
})
