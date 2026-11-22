export const GENERATION_COUNT_OPTIONS = [1, 2, 4, 6, 8] as const

export const MAX_GENERATION_COUNT = 8

function effectiveMax(maxCount: number | null | undefined): number {
  const value = maxCount ?? 1
  if (!Number.isFinite(value)) return 1
  return Math.max(1, Math.min(MAX_GENERATION_COUNT, Math.floor(value)))
}

export function clampGenerationCount(
  count: number | null | undefined,
  maxCount: number | null | undefined
): number {
  const max = effectiveMax(maxCount)
  const value = count ?? 1
  if (!Number.isFinite(value)) return Math.min(1, max)
  return Math.max(1, Math.min(max, Math.floor(value)))
}

export function generationCountOptions(
  maxCount: number | null | undefined,
  prefilledCount?: number | null
): number[] {
  const max = effectiveMax(maxCount)
  const options: number[] = GENERATION_COUNT_OPTIONS.filter((value) => value <= max)
  if (
    prefilledCount !== null &&
    prefilledCount !== undefined &&
    Number.isInteger(prefilledCount) &&
    prefilledCount >= 1 &&
    prefilledCount <= max &&
    !options.includes(prefilledCount)
  ) {
    options.push(prefilledCount)
  }
  if (!options.includes(max)) options.push(max)
  return [...new Set(options)].sort((left, right) => left - right)
}
