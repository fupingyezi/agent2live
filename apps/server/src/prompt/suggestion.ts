import {
  promptSuggestionOutputSchema,
  type CharacterBriefVersion,
  type PromptSpecV2,
  type PromptSuggestionOutput
} from '@agent2live/contracts'
import type { ChatContentPart, ChatMessage } from '@agent2live/providers'
import { AppError } from '../errors'
import { applyPromptOperations } from './apply-operations'
import { briefToContextText } from './brief-projection'
import { normalizeText } from './normalize'

const BRIEF_BLOCK_PREFIX = 'brief.'

const INVALID_OUTPUT_CODES = new Set([
  'PROMPT_BLOCK_LOCKED',
  'PROMPT_OPERATION_STALE',
  'PROMPT_OPERATION_INVALID',
  'PROMPT_LENGTH_EXCEEDS_LIMIT',
  'REQUEST_INVALID'
])

function invalidOutput(): AppError {
  return new AppError('PROMPT_SUGGESTION_INVALID_OUTPUT', { attempt: 1 })
}

export function parseSuggestionOutput(text: string): PromptSuggestionOutput {
  const trimmed = text.trim()
  const first = trimmed.indexOf('{')
  const last = trimmed.lastIndexOf('}')
  const candidates = [trimmed]
  if (first >= 0 && last > first) candidates.push(trimmed.slice(first, last + 1))
  for (const candidate of candidates) {
    try {
      return promptSuggestionOutputSchema.parse(JSON.parse(candidate))
    } catch {
      // A rejected candidate may still be a fenced or prefixed wrapper; try the next slice.
    }
  }
  throw invalidOutput()
}

export function validateSuggestionOutput(base: PromptSpecV2, output: PromptSuggestionOutput): PromptSpecV2 {
  if (output.operations.length === 0) throw invalidOutput()
  if (
    output.operations.some(
      (operation) => operation.op === 'add' && operation.block.id.startsWith(BRIEF_BLOCK_PREFIX)
    )
  ) {
    // The brief projection owns this namespace; an AI addition here would corrupt it.
    throw invalidOutput()
  }
  try {
    return applyPromptOperations(base, output.operations, {
      source: 'ai-suggestion',
      respectLockAll: true
    })
  } catch (error) {
    if (error instanceof AppError && INVALID_OUTPUT_CODES.has(error.code)) {
      throw invalidOutput()
    }
    throw error
  }
}

export function buildSuggestionPrompt(
  base: PromptSpecV2,
  brief: CharacterBriefVersion | null,
  intent: string,
  mockProtocol: boolean,
  maxPromptChars: number
): { messages: ChatMessage[] } {
  const state = JSON.stringify({
    lockAll: base.lockAll,
    blocks: base.blocks.map((block) => ({
      id: block.id,
      text: block.text,
      weight: block.weight,
      locked: block.locked,
      category: block.category
    })),
    negativeBlocks: base.negativeBlocks.map((block) => ({
      id: block.id,
      text: block.text,
      weight: block.weight,
      locked: block.locked,
      category: block.category
    })),
    requirements: base.sourceRequirements
  })
  const text = [
    'Propose a minimal set of PromptSpec operations for the user intent.',
    'Return ONLY JSON: {"operations":[...],"warnings":[...]}.',
    'Allowed operations: replace {op,blockId,before,after}, setWeight {op,blockId,before,after}, add {op,block}, remove {op,blockId,before}.',
    'Never touch a block with locked true or any block when lockAll is true. "before" must exactly match the current text or weight. Added blocks must use source "ai-suggestion" and locked false.',
    'The character brief is authoritative and every block with source "character-brief" is locked. Never modify, remove, or duplicate those blocks and never invent visual facts that contradict the brief.',
    `Pinned character brief version: ${brief?.id ?? '(none)'}`,
    `Character brief: ${brief ? briefToContextText(brief.content) : '(none)'}`,
    `User intent: ${normalizeText(intent)}`,
    `Current prompt: ${state}`
  ].join('\n')
  if (text.length > maxPromptChars) {
    throw new AppError('PROMPT_LENGTH_EXCEEDS_LIMIT', { length: text.length, limit: maxPromptChars })
  }
  const content: ChatContentPart[] = [{ type: 'text', text }]
  if (mockProtocol) {
    const envelope = {
      purpose: 'prompt.suggestion',
      intent: normalizeText(intent),
      blocks: [...base.blocks, ...base.negativeBlocks].map((block) => ({
        id: block.id,
        weight: block.weight,
        locked: block.locked
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
        content: 'You edit structured prompt data. Return strict JSON only, never markdown.'
      },
      { role: 'user', content }
    ]
  }
}
