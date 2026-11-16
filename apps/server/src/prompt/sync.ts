import {
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
import { AppError } from '../errors'
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
  throw new AppError('PROMPT_SYNC_INVALID_OUTPUT', { reason: 'invalid_json' })
}

export function parsePromptSyncOutput(text: string): PromptSyncOutput {
  try {
    return promptSyncOutputSchema.parse(parseJsonCandidate(text))
  } catch (error) {
    if (error instanceof AppError) throw error
    throw new AppError('PROMPT_SYNC_INVALID_OUTPUT', { reason: 'schema_invalid' })
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
    'Return ONLY one JSON object with keys: fullPrompt, operations, conflicts, warnings.',
    'fullPrompt must be one coherent natural-language paragraph, never a block list.',
    'Operations may only use replace, setWeight, add, and remove exactly as defined.',
    'Never modify, remove, or replace a block whose locked property is true, and never operate when lockAll is true.',
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
        content: 'You are a deterministic prompt-structure synchronizer for a Live2D character art tool.'
      },
      { role: 'user', content: text }
    ]
  }
}
