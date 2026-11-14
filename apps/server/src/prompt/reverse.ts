import {
  promptReverseOutputSchema,
  promptSpecSchema,
  type CharacterBriefVersion,
  type PromptReverseOutput,
  type PromptSpecV2
} from '@agent2live/contracts'
import type { ChatContentPart, ChatMessage } from '@agent2live/providers'
import { AppError } from '../errors'
import { specContentHash } from './compile'
import { assertBriefProjection, briefToContextText } from './brief-projection'
import { normalizeText } from './normalize'
import type { PromptInputSubmissionDto } from '../services/prompt-submissions'

export function parseReverseOutput(text: string): PromptReverseOutput {
  const trimmed = text.trim()
  const candidates = [trimmed]
  const first = trimmed.indexOf('{')
  const last = trimmed.lastIndexOf('}')
  if (first >= 0 && last > first) candidates.push(trimmed.slice(first, last + 1))
  for (const candidate of candidates) {
    try {
      return promptReverseOutputSchema.parse(JSON.parse(candidate))
    } catch {
      // A rejected candidate may still be a fenced or prefixed wrapper; try the next slice.
    }
  }
  throw new AppError('PROMPT_REVERSE_INVALID_OUTPUT', { attempt: 1 })
}

export function buildReverseState(
  base: PromptSpecV2,
  submission: PromptInputSubmissionDto,
  output: PromptReverseOutput,
  brief: CharacterBriefVersion | null = null
): PromptSpecV2 {
  const lockedMaterials = new Set(
    submission.materials.filter((material) => material.locked).map((material) => material.assetId)
  )
  const lockedPositive = base.blocks.filter((block) => block.locked)
  const lockedNegative = base.negativeBlocks.filter((block) => block.locked)
  const lockedIds = new Set([...lockedPositive, ...lockedNegative].map((block) => block.id))
  const lockDerived = <T extends { locked: boolean; materialRefs: string[] }>(block: T): T => ({
    ...block,
    locked: block.materialRefs.some((assetId) => lockedMaterials.has(assetId))
  })
  const next: PromptSpecV2 = {
    ...base,
    characterBriefVersionId: submission.characterBriefVersionId,
    sourceRequirements: submission.requirements,
    materialRefs: submission.materials.map((material) => ({
      assetId: material.assetId,
      role: material.role,
      note: material.note,
      weight: material.weight,
      locked: material.locked
    })),
    blocks: [
      ...output.blocks.filter((block) => !lockedIds.has(block.id)).map(lockDerived),
      ...lockedPositive
    ],
    negativeBlocks: [
      ...output.negativeBlocks.filter((block) => !lockedIds.has(block.id)).map(lockDerived),
      ...lockedNegative
    ]
  }
  const positiveRefs = new Set(next.blocks.flatMap((block) => block.requirementRefs))
  const negativeRefs = new Set(next.negativeBlocks.flatMap((block) => block.requirementRefs))
  const uncovered = submission.requirements.filter((requirement) =>
    requirement.strength === 'must'
      ? !positiveRefs.has(requirement.id)
      : requirement.strength === 'avoid'
        ? !negativeRefs.has(requirement.id)
        : false
  )
  if (uncovered.length > 0) {
    throw new AppError('PROMPT_REVERSE_INVALID_OUTPUT', { attempt: 1 })
  }
  if (brief) {
    assertBriefProjection(next, brief.content)
  } else if (next.blocks.some((block) => block.source === 'character-brief')) {
    throw new AppError('PROMPT_REVERSE_INVALID_OUTPUT', { attempt: 1 })
  }
  try {
    return promptSpecSchema.parse(next)
  } catch {
    throw new AppError('PROMPT_REVERSE_INVALID_OUTPUT', { attempt: 1 })
  }
}

export function reverseContentHash(state: PromptSpecV2): string {
  return specContentHash(state)
}

export function buildReverseMessages(input: {
  base: PromptSpecV2
  submission: PromptInputSubmissionDto
  brief: CharacterBriefVersion | null
  images: Array<{ mimeType: 'image/png' | 'image/jpeg' | 'image/webp'; data: Buffer }>
  mockProtocol: boolean
  maxPromptChars: number
}): { messages: ChatMessage[]; warnings: string[] } {
  const warnings: string[] = []
  if (input.submission.materials.length > input.images.length) {
    warnings.push(
      `only ${input.images.length} of ${input.submission.materials.length} reference images fit the provider limit`
    )
  }
  const requirements = input.submission.requirements
    .map((item) => `- [${item.strength}] ${item.id}: ${normalizeText(item.text)}`)
    .join('\n')
  const materials = input.submission.materials
    .map(
      (item, index) =>
        `- image ${index + 1}: role=${item.role} locked=${item.locked} note=${normalizeText(item.note)}`
    )
    .join('\n')
  const text = [
    'Generate a PromptSpec for a character illustration from the supplied reference images and requirements.',
    'Return ONLY a JSON object: {"blocks":[...],"negativeBlocks":[...],"warnings":[...]}.',
    'Every block must have source "vision-model", locked false, a unique id, category from the allowed set, label, text, weight, confidence, evidence, priority, requirementRefs and materialRefs.',
    'Positive blocks must cite every must requirement. Negative blocks must use category "negative" and cite every avoid requirement. Prefer requirements are optional.',
    'The character brief and its projected locked blocks are authoritative. Do not contradict them, do not emit brief.* block ids, and never invent visual facts that are absent from both the brief and the reference images.',
    `Global notes: ${normalizeText(input.submission.globalNotes) || '(none)'}`,
    'Requirements:',
    requirements || '(none)',
    'Materials:',
    materials || '(none)',
    'Character brief:',
    input.brief ? briefToContextText(input.brief.content) : '(none)',
    `Pinned character brief version: ${input.brief?.id ?? '(none)'}`
  ].join('\n')
  if (text.length > input.maxPromptChars) {
    throw new AppError('PROMPT_LENGTH_EXCEEDS_LIMIT', { length: text.length, limit: input.maxPromptChars })
  }
  const content: ChatContentPart[] = [{ type: 'text', text }]
  for (const image of input.images) content.push({ type: 'image', ...image })
  if (input.mockProtocol) {
    const envelope = {
      purpose: 'prompt.reverse',
      characterBriefVersionId: input.submission.characterBriefVersionId,
      globalNotes: normalizeText(input.submission.globalNotes),
      requirements: input.submission.requirements,
      materials: input.submission.materials.map((item) => ({
        assetId: item.assetId,
        role: item.role,
        note: normalizeText(item.note),
        locked: item.locked
      }))
    }
    content.push({
      type: 'text',
      text: `AGENT2LIVE_MOCK_INPUT=${Buffer.from(JSON.stringify(envelope)).toString('base64url')}`
    })
  }
  return {
    messages: [
      {
        role: 'system',
        content:
          'You produce strict machine-readable character prompt data. Never include markdown fences or commentary.'
      },
      { role: 'user', content }
    ],
    warnings
  }
}
