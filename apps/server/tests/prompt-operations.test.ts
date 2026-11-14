import { describe, expect, it } from 'vitest'
import type { PromptOperation } from '@agent2live/contracts'
import { applyPromptOperations } from '../src/prompt/apply-operations'
import { specFixture } from './fixtures/spec'

describe('applyPromptOperations', () => {
  it('applies replace, setWeight, add, and setWeight on a newly added block', () => {
    const spec = specFixture()
    const operations: PromptOperation[] = [
      {
        op: 'replace',
        blockId: 'style.rendering',
        before: '清爽的日系赛璐璐插画，干净线稿',
        after: '清爽的赛璐璐插画',
        reason: '更短'
      },
      { op: 'setWeight', blockId: 'background.simple', before: 1, after: 0.8 },
      {
        op: 'add',
        block: {
          id: 'style.lineart',
          category: 'style',
          label: '线稿',
          text: '细而干净的线稿',
          weight: 1,
          locked: false,
          confidence: 0.7,
          evidence: [],
          source: 'user',
          priority: 60,
          requirementRefs: [],
          materialRefs: []
        }
      },
      { op: 'setWeight', blockId: 'style.lineart', before: 1, after: 1.2 }
    ]
    const next = applyPromptOperations(spec, operations, { source: 'ai-suggestion' })
    expect(next.blocks.find((block) => block.id === 'style.rendering')?.text).toBe('清爽的赛璐璐插画')
    expect(next.blocks.find((block) => block.id === 'background.simple')?.weight).toBe(0.8)
    expect(next.blocks.find((block) => block.id === 'style.lineart')?.source).toBe('ai-suggestion')
    expect(next.blocks.find((block) => block.id === 'style.lineart')?.weight).toBe(1.2)
    expect(spec.blocks).toHaveLength(3)
  })

  it('rejects locked targets, stale before values, duplicate adds, and unknown ids', () => {
    const spec = specFixture()
    const locked: PromptOperation[] = [
      { op: 'replace', blockId: 'subject.identity', before: 'x', after: 'y' }
    ]
    expect(() => applyPromptOperations(spec, locked, { source: 'ai-suggestion' })).toThrowError(
      expect.objectContaining({ code: 'PROMPT_BLOCK_LOCKED' })
    )

    const stale: PromptOperation[] = [
      { op: 'replace', blockId: 'style.rendering', before: '旧文本', after: '新文本' }
    ]
    expect(() => applyPromptOperations(spec, stale, { source: 'ai-suggestion' })).toThrowError(
      expect.objectContaining({ code: 'PROMPT_OPERATION_STALE' })
    )

    const duplicate: PromptOperation[] = [
      {
        op: 'add',
        block: {
          id: 'style.rendering',
          category: 'style',
          label: '重复',
          text: '重复 ID',
          weight: 1,
          locked: false,
          confidence: 0.5,
          evidence: [],
          source: 'user',
          priority: 10,
          requirementRefs: [],
          materialRefs: []
        }
      }
    ]
    expect(() => applyPromptOperations(spec, duplicate, { source: 'ai-suggestion' })).toThrowError(
      expect.objectContaining({ code: 'PROMPT_OPERATION_INVALID' })
    )

    const unknown: PromptOperation[] = [{ op: 'setWeight', blockId: 'missing.block', before: 1, after: 1.2 }]
    expect(() => applyPromptOperations(spec, unknown, { source: 'ai-suggestion' })).toThrowError(
      expect.objectContaining({ code: 'PROMPT_OPERATION_STALE' })
    )
  })

  it('treats lockAll as a lock on every block', () => {
    const spec = { ...specFixture(), lockAll: true }
    const operation: PromptOperation[] = [
      { op: 'setWeight', blockId: 'style.rendering', before: 1, after: 1.2 }
    ]
    expect(() => applyPromptOperations(spec, operation, { source: 'ai-suggestion' })).toThrowError(
      expect.objectContaining({ code: 'PROMPT_BLOCK_LOCKED' })
    )
  })
})
