import { describe, expect, it } from 'vitest'
import { parseSuggestionOutput, validateSuggestionOutput } from '../src/prompt/suggestion'
import { specFixture } from './fixtures/spec'

const base = specFixture()
const addOperation = {
  op: 'add',
  block: {
    id: 'ai.suggestion.mock',
    category: 'style',
    label: 'AI 建议',
    text: '更柔和的逆光',
    weight: 1,
    locked: false,
    confidence: 0.5,
    evidence: [],
    source: 'ai-suggestion',
    priority: 10,
    requirementRefs: [],
    materialRefs: []
  }
}

describe('prompt suggestion output', () => {
  it('parses plain and fenced JSON', () => {
    expect(parseSuggestionOutput(JSON.stringify({ operations: [addOperation] })).operations).toHaveLength(1)
    expect(
      parseSuggestionOutput('```json\n' + JSON.stringify({ operations: [addOperation] }) + '\n```').operations
    ).toHaveLength(1)
  })

  it('fills optional fields on minimal add blocks returned by chat models', () => {
    const output = parseSuggestionOutput(
      JSON.stringify({
        operations: [
          {
            op: 'add',
            block: {
              id: 'outfit.shoes',
              category: 'outfit',
              text: '酒红色高跟鞋',
              weight: 1.1,
              locked: false,
              source: 'ai-suggestion'
            }
          }
        ]
      })
    )
    expect(output.operations[0]).toMatchObject({
      op: 'add',
      block: {
        id: 'outfit.shoes',
        label: 'outfit.shoes',
        confidence: 0.7,
        priority: 0,
        evidence: [],
        requirementRefs: [],
        materialRefs: []
      }
    })
    expect(validateSuggestionOutput(base, output).blocks.some((block) => block.id === 'outfit.shoes')).toBe(
      true
    )
  })

  it('maps malformed or locked add operations to PROMPT_SUGGESTION_INVALID_OUTPUT', () => {
    expect(() => parseSuggestionOutput('nope')).toThrow(
      expect.objectContaining({ code: 'PROMPT_SUGGESTION_INVALID_OUTPUT' })
    )
    const locked = structuredClone(addOperation) as { block: { locked: boolean } }
    locked.block.locked = true
    // The schema's !locked refine rejects a locked add before it ever reaches validation.
    expect(() => parseSuggestionOutput(JSON.stringify({ operations: [locked] }))).toThrow(
      expect.objectContaining({ code: 'PROMPT_SUGGESTION_INVALID_OUTPUT' })
    )
  })

  it('rejects stale operations because before no longer matches', () => {
    const op = {
      op: 'replace',
      blockId: 'style.rendering',
      before: '不存在的旧文本',
      after: '新文本'
    }
    expect(() =>
      validateSuggestionOutput(base, parseSuggestionOutput(JSON.stringify({ operations: [op] })))
    ).toThrow(expect.objectContaining({ code: 'PROMPT_SUGGESTION_INVALID_OUTPUT' }))
  })

  it('accepts an empty operation set as a no-op suggestion', () => {
    const output = parseSuggestionOutput(JSON.stringify({ operations: [], warnings: ['当前描述已符合要求'] }))
    expect(validateSuggestionOutput(base, output).blocks).toEqual(base.blocks)
  })

  it('rejects additions in the brief namespace', () => {
    const reserved = structuredClone(addOperation) as { block: { id: string } }
    reserved.block.id = 'brief.appearance.hair'
    expect(() =>
      validateSuggestionOutput(base, parseSuggestionOutput(JSON.stringify({ operations: [reserved] })))
    ).toThrow(expect.objectContaining({ code: 'PROMPT_SUGGESTION_INVALID_OUTPUT' }))
  })
})
