import { PROMPT_CATEGORIES, type PromptBlock, type PromptSpecV2 } from '@agent2live/contracts'
import { normalizeText } from './normalize'

const CATEGORY_RANK = new Map(PROMPT_CATEGORIES.map((category, index) => [category, index]))

function orderedBlocks(blocks: PromptBlock[]): PromptBlock[] {
  return [...blocks].sort((left, right) => {
    const category =
      (CATEGORY_RANK.get(left.category) ?? PROMPT_CATEGORIES.length) -
      (CATEGORY_RANK.get(right.category) ?? PROMPT_CATEGORIES.length)
    if (category !== 0) return category
    if (left.priority !== right.priority) return right.priority - left.priority
    return left.id.localeCompare(right.id)
  })
}

function uniqueTexts(blocks: PromptBlock[]): string[] {
  return [
    ...new Set(
      orderedBlocks(blocks)
        .map((block) => normalizeText(block.text))
        .filter(Boolean)
    )
  ]
}

export function normalizeLegacyFullPrompt(spec: PromptSpecV2): PromptSpecV2 {
  if (spec.fullPrompt.trim()) return { ...spec, fullPrompt: spec.fullPrompt.trim() }
  const positive = uniqueTexts(spec.blocks)
  if (positive.length === 0) return { ...spec, fullPrompt: '' }
  const negative = uniqueTexts(spec.negativeBlocks)
  const prompt = `${positive.join('；')}。${negative.length > 0 ? ` 避免${negative.join('；')}。` : ''}`
  return { ...spec, fullPrompt: prompt }
}
