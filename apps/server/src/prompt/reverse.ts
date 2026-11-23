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
import { normalizeLegacyFullPrompt } from './full-prompt'
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
    base.materialRefs.filter((material) => material.locked).map((material) => material.assetId)
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
    // The accepted blocks are authoritative after a reverse; the base prose no longer describes them.
    fullPrompt: '',
    characterBriefVersionId: submission.characterBriefVersionId,
    sourceRequirements: submission.requirements,
    materialRefs: structuredClone(base.materialRefs),
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
    return normalizeLegacyFullPrompt(promptSpecSchema.parse(next))
  } catch {
    throw new AppError('PROMPT_REVERSE_INVALID_OUTPUT', { attempt: 1 })
  }
}

export function mergeReverseBlocks(
  base: PromptSpecV2,
  proposal: PromptSpecV2,
  blockIds: readonly string[]
): PromptSpecV2 {
  const selected = new Set(blockIds)
  const proposalBlocks = new Map(
    [...proposal.blocks, ...proposal.negativeBlocks].map((block) => [block.id, block])
  )
  for (const blockId of selected) {
    if (!proposalBlocks.has(blockId)) {
      throw new AppError('REQUEST_INVALID', { reason: `unknown reverse block ${blockId}` })
    }
  }
  const selectedPositive = proposal.blocks.filter((block) => selected.has(block.id))
  const selectedNegative = proposal.negativeBlocks.filter((block) => selected.has(block.id))
  const positiveById = new Map(selectedPositive.map((block) => [block.id, block]))
  const negativeById = new Map(selectedNegative.map((block) => [block.id, block]))
  const existingPositive = new Set(base.blocks.map((block) => block.id))
  const existingNegative = new Set(base.negativeBlocks.map((block) => block.id))
  const blocks = base.blocks.map((block) => positiveById.get(block.id) ?? block)
  const negativeBlocks = base.negativeBlocks.map((block) => negativeById.get(block.id) ?? block)
  for (const block of selectedPositive) {
    if (!existingPositive.has(block.id)) blocks.push(block)
  }
  for (const block of selectedNegative) {
    if (!existingNegative.has(block.id)) negativeBlocks.push(block)
  }
  return normalizeLegacyFullPrompt(
    promptSpecSchema.parse({
      ...base,
      fullPrompt: '',
      blocks,
      negativeBlocks
    })
  )
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
  if (input.base.materialRefs.length > input.images.length) {
    warnings.push(
      `only ${input.images.length} of ${input.base.materialRefs.length} reference images fit the provider limit`
    )
  }
  const requirements = input.submission.requirements
    .map((item) => `- [${item.strength}] ${item.id}: ${normalizeText(item.text)}`)
    .join('\n')
  const materials = input.base.materialRefs
    .map(
      (item, index) =>
        `- image ${index + 1}: assetId=${item.assetId} role=${item.role} locked=${item.locked} note=${normalizeText(item.note)}`
    )
    .join('\n')
  const text = [
    'Generate a PromptSpec for a character illustration from the supplied reference images and requirements.',
    'Return ONLY a JSON object: {"blocks":[...],"negativeBlocks":[...],"warnings":[...]}.',
    'Allowed positive block categories: subject, face, hair, outfit, pose, composition, style, lighting, background, safety, other.',
    'Every block must use exactly these keys: id, source, locked, category, label, text, weight, confidence, evidence, priority, requirementRefs, materialRefs.',
    'A block must use this JSON shape: {"id":"hair.silver","source":"vision-model","locked":false,"category":"hair","label":"银白长发","text":"...","weight":1.2,"confidence":0.8,"evidence":[{"assetId":"ast_..."}],"priority":0,"requirementRefs":["req_identity"],"materialRefs":["ast_..."]}.',
    'Every block id MUST match ^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$ using lowercase ASCII only; never use camelCase or uppercase letters.',
    'evidence MUST be an array of objects like [{"assetId":"ast_..."}], never an array of strings. priority MUST be an integer number, never a string.',
    'materialRefs MUST contain only exact assetId values from the Materials list; never use image numbers, roles, URLs, or notes there.',
    'Set every generated block locked=false, even when a material is marked locked=true. The server derives material locks after parsing; copying true invalidates the entire response.',
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
      materials: input.base.materialRefs.map((item) => ({
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
