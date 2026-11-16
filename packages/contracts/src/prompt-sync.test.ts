import { describe, expect, it } from 'vitest'
import { promptSyncInputSchema, promptSyncOutputSchema, promptSyncResultSchema } from './prompt-sync'

function state() {
  return {
    schemaVersion: 'prompt-spec/2' as const,
    fullPrompt: '银白长发少女，清爽赛璐璐画风。',
    lockAll: false,
    sourceRequirements: [],
    materialRefs: [],
    blocks: [
      {
        id: 'subject.identity',
        category: 'subject' as const,
        label: '人物身份',
        text: '银白长发少女',
        weight: 1,
        locked: true,
        confidence: 1,
        evidence: [],
        source: 'character-brief' as const,
        priority: 100,
        requirementRefs: [],
        materialRefs: []
      }
    ],
    negativeBlocks: [],
    constraints: {
      canvas: { width: 1024, height: 1792 },
      background: 'transparent' as const,
      aspect: 'portrait' as const
    }
  }
}

describe('prompt sync contracts', () => {
  it('parses both edit sources and both modes', () => {
    const spec = state()
    expect(
      promptSyncInputSchema.parse({
        providerConnectionId: 'conn_test',
        source: 'full',
        mode: 'optimize',
        state: spec
      }).source
    ).toBe('full')
    expect(
      promptSyncInputSchema.parse({
        providerConnectionId: 'conn_test',
        source: 'blocks',
        state: spec
      }).mode
    ).toBe('sync')
  })

  it('requires a non-empty coherent full prompt from the model', () => {
    expect(() =>
      promptSyncOutputSchema.parse({
        fullPrompt: '   ',
        operations: [],
        warnings: []
      })
    ).toThrow()
  })

  it('requires the synchronized result to contain one PromptSpec pair', () => {
    const parsed = promptSyncResultSchema.parse({
      state: state(),
      conflicts: [],
      warnings: []
    })
    expect(parsed.state.fullPrompt).not.toBe('')
    expect(parsed.state.blocks.length).toBeGreaterThan(0)
  })
})
