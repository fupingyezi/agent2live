import {
  effectiveBlockStrength,
  hashCanonical,
  promptSpecCoreSchema,
  type ImageCapabilityProfile,
  type PromptBlock,
  type PromptSpecCore,
  type PromptSpecV2
} from '@agent2live/contracts'

export interface CompiledPrompt {
  prompt: string
  negativePrompt: string
  truncated: boolean
  droppedBlockIds: string[]
  warnings: string[]
  promptLength: number
}

const CATEGORY_ORDER = [
  'subject',
  'face',
  'hair',
  'outfit',
  'pose',
  'composition',
  'style',
  'lighting',
  'background',
  'safety',
  'other'
] as const

const CATEGORY_RANK = new Map<string, number>(CATEGORY_ORDER.map((category, index) => [category, index]))
const MANDATORY_CATEGORIES = new Set(['subject', 'face', 'safety'])

export function specCoreOf(spec: PromptSpecV2): PromptSpecCore {
  return {
    schemaVersion: spec.schemaVersion,
    fullPrompt: spec.fullPrompt,
    lockAll: spec.lockAll,
    sourceRequirements: spec.sourceRequirements,
    materialRefs: spec.materialRefs,
    blocks: spec.blocks,
    negativeBlocks: spec.negativeBlocks,
    constraints: spec.constraints
  }
}

function compareBlocks(left: PromptBlock, right: PromptBlock): number {
  const rank =
    (CATEGORY_RANK.get(left.category) ?? CATEGORY_ORDER.length) -
    (CATEGORY_RANK.get(right.category) ?? CATEGORY_ORDER.length)
  if (rank !== 0) return rank
  if (left.priority !== right.priority) return right.priority - left.priority
  return left.id.localeCompare(right.id)
}

function textLength(text: string): number {
  return Array.from(text).length
}

function formatBlock(block: PromptBlock, supportsWeightSyntax: boolean): string {
  if (!supportsWeightSyntax || block.weight === 1) return block.text
  return `(${block.text}):${block.weight.toFixed(1)}`
}

function assemble(blocks: PromptBlock[], supportsWeightSyntax: boolean): string {
  return blocks.map((block) => formatBlock(block, supportsWeightSyntax)).join(', ')
}

export function compilePrompt(spec: PromptSpecV2, capability: ImageCapabilityProfile): CompiledPrompt {
  const core = promptSpecCoreSchema.parse(specCoreOf(spec))
  const warnings: string[] = []
  const positives = [...core.blocks].sort(compareBlocks)
  const negatives = [...core.negativeBlocks].sort(compareBlocks)
  if (!capability.supportsWeightSyntax && [...positives, ...negatives].some((block) => block.weight !== 1)) {
    warnings.push('weights_not_supported')
  }

  let positiveBlocks = positives
  const foldNegative = !capability.supportsNegativePrompt && negatives.length > 0
  if (foldNegative) warnings.push('negative_prompt_folded')
  const negativePrompt = capability.supportsNegativePrompt
    ? assemble(negatives, capability.supportsWeightSyntax)
    : ''
  const foldedNegative = foldNegative ? `Avoid: ${assemble(negatives, capability.supportsWeightSyntax)}` : ''
  const join = (parts: string[]) => [...parts, foldedNegative].filter(Boolean).join(', ')
  let output = join(positiveBlocks.map((block) => formatBlock(block, capability.supportsWeightSyntax)))
  const dropped: string[] = []
  if (textLength(output) > capability.maxPromptChars) {
    const droppable = positiveBlocks
      .filter(
        (block) =>
          !block.locked &&
          !MANDATORY_CATEGORIES.has(block.category) &&
          effectiveBlockStrength(block, false) !== 'must'
      )
      .sort((left, right) => {
        if (left.priority !== right.priority) return left.priority - right.priority
        return left.id.localeCompare(right.id)
      })
    for (const block of droppable) {
      if (textLength(output) <= capability.maxPromptChars) break
      positiveBlocks = positiveBlocks.filter((candidate) => candidate.id !== block.id)
      output = join(
        positiveBlocks.map((candidate) => formatBlock(candidate, capability.supportsWeightSyntax))
      )
      dropped.push(block.id)
    }
    if (dropped.length > 0) warnings.push('truncated')
  }

  const prompt = output
  const promptLength = capability.supportsNegativePrompt
    ? Math.max(textLength(prompt), textLength(negativePrompt))
    : textLength(prompt)
  if (promptLength > capability.maxPromptChars) warnings.push('mandatory_content_exceeds_limit')
  return {
    prompt,
    negativePrompt,
    truncated: dropped.length > 0,
    droppedBlockIds: dropped,
    warnings: [...new Set(warnings)],
    promptLength
  }
}

export function specContentHash(spec: PromptSpecV2): string {
  return hashCanonical(promptSpecCoreSchema.parse(specCoreOf(spec)))
}
