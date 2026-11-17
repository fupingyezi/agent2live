import {
  PROMPT_CATEGORIES,
  PROMPT_SOURCES,
  promptSyncOutputSchema,
  promptSyncResultSchema,
  type CharacterBriefVersion,
  type PromptBlock,
  type PromptOperation,
  type PromptSyncConflict,
  type PromptSyncInput,
  type PromptSyncOutput,
  type PromptSyncResultDto
} from '@agent2live/contracts'
import type { ChatMessage } from '@agent2live/providers'
import { AppError, zodErrorDetails } from '../errors'
import { applyPromptOperations } from './apply-operations'

function parseJsonCandidate(text: string): unknown {
  const trimmed = text.trim()
  const candidates = [trimmed]
  const first = trimmed.indexOf('{')
  const last = trimmed.lastIndexOf('}')
  if (first >= 0 && last > first) candidates.push(trimmed.slice(first, last + 1))
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate)
    } catch {
      // Try the next candidate in case the model wrapped the JSON.
    }
  }
  throw new AppError(
    'PROMPT_SYNC_INVALID_OUTPUT',
    { reason: 'invalid_json' },
    'prompt sync output JSON is invalid (invalid_json)'
  )
}

export function parsePromptSyncOutput(text: string): PromptSyncOutput {
  try {
    return promptSyncOutputSchema.parse(parseJsonCandidate(text))
  } catch (error) {
    if (error instanceof AppError) throw error
    const issues = zodErrorDetails(error)?.issues ?? []
    const summary = issues
      .slice(0, 5)
      .map((issue) => (issue.path ? `${issue.path}: ${issue.code}` : issue.code))
      .join('; ')
    throw new AppError(
      'PROMPT_SYNC_INVALID_OUTPUT',
      { reason: 'schema_invalid', issues },
      `prompt sync output failed schema validation (schema_invalid)${summary ? `: ${summary}` : ''}`
    )
  }
}

function findBlock(spec: PromptSyncInput['state'], blockId: string): PromptBlock | null {
  return [...spec.blocks, ...spec.negativeBlocks].find((block) => block.id === blockId) ?? null
}

function lockedConflicts(
  spec: PromptSyncInput['state'],
  operations: PromptOperation[]
): PromptSyncConflict[] {
  const conflicts: PromptSyncConflict[] = []
  for (const operation of operations) {
    if (operation.op === 'add') continue
    const target = findBlock(spec, operation.blockId)
    if (!target) {
      throw new AppError('PROMPT_SYNC_INVALID_OUTPUT', { reason: 'unknown_block_id' })
    }
    if (target.locked || spec.lockAll) {
      conflicts.push({
        blockId: target.id,
        message: 'locked block cannot be synchronized automatically'
      })
    }
  }
  return conflicts
}

export function applyPromptSyncOutput(input: PromptSyncInput, output: PromptSyncOutput): PromptSyncResultDto {
  if (input.source === 'full' && !input.state.fullPrompt.trim()) {
    throw new AppError(
      'PROMPT_SYNC_INVALID_OUTPUT',
      { reason: 'full_prompt_required' },
      'fullPrompt is required'
    )
  }
  if (input.source === 'blocks') {
    const result = promptSyncResultSchema.parse({
      state: { ...input.state, fullPrompt: output.fullPrompt },
      conflicts: [],
      warnings: [
        ...output.warnings,
        ...(output.operations.length > 0 ? ['operations_ignored_for_blocks_source'] : [])
      ]
    })
    return result
  }

  const conflicts = lockedConflicts(input.state, output.operations)
  if (conflicts.length > 0) {
    return promptSyncResultSchema.parse({
      state: input.state,
      conflicts,
      warnings: output.warnings
    })
  }

  let state = applyPromptOperations(input.state, output.operations, {
    source: 'ai-suggestion',
    respectLockAll: true
  })
  state = {
    ...state,
    fullPrompt: input.mode === 'optimize' ? output.fullPrompt : input.state.fullPrompt
  }
  if (input.mode === 'optimize' && state.blocks.length === 0) {
    throw new AppError('PROMPT_SYNC_INVALID_OUTPUT', { reason: 'optimized_blocks_required' })
  }
  return promptSyncResultSchema.parse({
    state,
    conflicts: [],
    warnings: output.warnings
  })
}

export function buildPromptSyncMessages(
  input: PromptSyncInput,
  brief: CharacterBriefVersion | null = null
): { messages: ChatMessage[] } {
  const text = [
    'Synchronize one character-illustration prompt representation into the other.',
    'Return ONLY one JSON object with EXACTLY these keys: fullPrompt, operations, conflicts, warnings.',
    'fullPrompt MUST be a single coherent natural-language paragraph, never a block list.',
    'conflicts MUST be an array of objects {"blockId":"<id>","message":"<text>"}; normally return [].',
    'warnings MUST be an array of strings; normally return [].',
    'Every operations entry MUST use the key "op" (NOT "type") and MUST match exactly one of these shapes, with no extra keys:',
    '{"op":"add","block":BLOCK}',
    '{"op":"replace","blockId":"<existing-id>","before":"<exact current text>","after":"<new text>"}',
    '{"op":"setWeight","blockId":"<existing-id>","before":1.2,"after":1.5}',
    '{"op":"remove","blockId":"<existing-id>","before":"<exact current text>"}',
    'BLOCK MUST have EXACTLY these keys: id, source, locked, category, label, text, weight, confidence, evidence, priority, requirementRefs, materialRefs.',
    'Example BLOCK: {"id":"hair.silver","source":"ai-suggestion","locked":false,"category":"hair","label":"银白长发","text":"...","weight":1.2,"confidence":0.8,"evidence":[],"priority":0,"requirementRefs":[],"materialRefs":[]}.',
    'id MUST match ^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$ using lowercase ASCII only and MUST NOT duplicate an existing id in PROMPT_SPEC. Do NOT emit brief.* ids.',
    `source MUST be exactly one of: ${PROMPT_SOURCES.join(', ')}. For added blocks use ai-suggestion.`,
    `category MUST be exactly one of: ${PROMPT_CATEGORIES.join(', ')}.`,
    'Put avoid/negative concepts only in blocks with category "negative".',
    'evidence MUST be an array of objects; use [] when there is no asset evidence. priority MUST be an integer. weight MUST be a number between 0.1 and 2. confidence MUST be a number between 0 and 1.',
    'requirementRefs MUST be an array of strings. materialRefs MUST be an array of exact ast_ ids found in PROMPT_SPEC; use [] when none.',
    'Set locked=false on every added block. NEVER modify, remove, or replace a block whose locked property is true, and never operate when lockAll is true.',
    'For replace/remove, "before" MUST exactly equal the current block text.',
    input.source === 'blocks'
      ? 'The provided granular blocks are authoritative. Return operations=[] and write a coherent fullPrompt from them without inventing facts.'
      : 'The provided fullPrompt is authoritative. Return operations that split it into granular blocks while preserving every locked block.',
    input.mode === 'optimize'
      ? 'Optimize the input into a clear, complete visual prompt while staying faithful to the character brief and unlocked source material.'
      : 'Preserve the user meaning and only synchronize formatting between representations.',
    `PROMPT_EDIT_SOURCE=${input.source}`,
    `PROMPT_SYNC_MODE=${input.mode}`,
    `CHARACTER_BRIEF=${JSON.stringify(brief?.content ?? null)}`,
    `PROMPT_SPEC=${JSON.stringify(input.state)}`
  ].join('\n')
  return {
    messages: [
      {
        role: 'system',
        content: 'You are a deterministic prompt-structure synchronizer. Output strict JSON only.'
      },
      { role: 'user', content: text }
    ]
  }
}
