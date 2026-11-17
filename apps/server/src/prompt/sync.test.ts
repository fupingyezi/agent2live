import { describe, expect, it } from 'vitest'
import {
  PROMPT_CATEGORIES,
  PROMPT_SOURCES,
  promptSyncOutputSchema,
  type PromptSyncInput
} from '@agent2live/contracts'
import { AppError } from '../errors'
import { specFixture } from '../../tests/fixtures/spec'
import { applyPromptSyncOutput, buildPromptSyncMessages, parsePromptSyncOutput } from './sync'

function input(overrides: Partial<PromptSyncInput> = {}): PromptSyncInput {
  return {
    providerConnectionId: 'conn_test',
    source: 'full',
    mode: 'sync',
    state: specFixture(),
    ...overrides
  }
}

function output(overrides: Record<string, unknown> = {}) {
  return promptSyncOutputSchema.parse({
    fullPrompt: 'AI 生成的完整提示词。',
    operations: [],
    conflicts: [],
    warnings: [],
    ...overrides
  })
}

function promptText(syncInput: PromptSyncInput): string {
  return buildPromptSyncMessages(syncInput)
    .messages.map((message) =>
      typeof message.content === 'string'
        ? message.content
        : message.content.map((part) => (part.type === 'text' ? part.text : '')).join('')
    )
    .join('\n')
}

describe('prompt sync pure functions', () => {
  it('uses the edited full prompt verbatim and applies operations to unlocked blocks', () => {
    const base = specFixture()
    base.fullPrompt = '用户亲自改写的完整提示词。'
    const next = applyPromptSyncOutput(
      input({ state: base }),
      output({
        operations: [
          {
            op: 'replace',
            blockId: 'style.rendering',
            before: '清爽的日系赛璐璐插画，干净线稿',
            after: '干净的厚涂插画',
            reason: '按完整描述拆分'
          }
        ]
      })
    )

    expect(next.state.fullPrompt).toBe(base.fullPrompt)
    expect(next.state.blocks.find((block) => block.id === 'style.rendering')?.text).toBe('干净的厚涂插画')
    expect(next.state.blocks.find((block) => block.id === 'subject.identity')).toEqual(
      base.blocks.find((block) => block.id === 'subject.identity')
    )
  })

  it('keeps blocks unchanged and only replaces the full prompt for blocks source', () => {
    const base = specFixture()
    const next = applyPromptSyncOutput(
      input({ source: 'blocks', state: base }),
      output({
        fullPrompt: '连贯描述全部颗粒块的新完整提示词。',
        operations: [
          {
            op: 'replace',
            blockId: 'style.rendering',
            before: '清爽的日系赛璐璐插画，干净线稿',
            after: '这段操作不应生效'
          }
        ]
      })
    )

    expect(next.state.fullPrompt).toBe('连贯描述全部颗粒块的新完整提示词。')
    expect(next.state.blocks).toEqual(base.blocks)
    expect(next.warnings).toContain('operations_ignored_for_blocks_source')
  })

  it('returns an unchanged pair and a conflict when AI edits a locked block', () => {
    const base = specFixture()
    base.fullPrompt = '用户完整提示词。'
    const next = applyPromptSyncOutput(
      input({ state: base }),
      output({
        operations: [
          {
            op: 'replace',
            blockId: 'subject.identity',
            before: '银白长发的蓝眼少女，正视半身',
            after: '被错误改写的身份'
          }
        ]
      })
    )

    expect(next.state).toEqual(base)
    expect(next.conflicts).toEqual([
      { blockId: 'subject.identity', message: 'locked block cannot be synchronized automatically' }
    ])
  })

  it('optimizes an initial full prompt into blocks', () => {
    const base = specFixture()
    base.fullPrompt = '银白长发少女，清爽赛璐璐画风，不要写实皮肤。'
    base.blocks = base.blocks.filter((block) => block.locked)
    const next = applyPromptSyncOutput(
      input({ state: base, mode: 'optimize' }),
      output({
        fullPrompt: '银白长发蓝眼少女，正面半身，清爽赛璐璐画风，避免写实皮肤。',
        operations: [
          {
            op: 'add',
            block: {
              ...base.blocks[0]!,
              id: 'style.optimized',
              category: 'style',
              label: '优化画风',
              text: '清爽赛璐璐画风',
              source: 'ai-suggestion',
              locked: false,
              requirementRefs: []
            }
          }
        ]
      })
    )

    expect(next.conflicts).toEqual([])
    expect(next.state.fullPrompt).toContain('避免写实皮肤')
    expect(next.state.blocks.some((block) => block.id === 'style.optimized')).toBe(true)
  })

  it('rejects an empty full prompt for full-source synchronization', () => {
    const base = specFixture()
    base.fullPrompt = ' '
    expect(() => applyPromptSyncOutput(input({ state: base }), output())).toThrow(/fullPrompt/)
  })

  it('includes both representations and allowed operation rules in the model prompt', () => {
    const { messages } = buildPromptSyncMessages(input())
    const text = JSON.stringify(messages)
    expect(text).toContain('银白长发的蓝眼少女')
    expect(text).toContain('fullPrompt')
    expect(text).toContain('locked')
    expect(text).toContain('operations')
  })

  it('spells out the strict operation, block, and conflict contract for the model', () => {
    const text = promptText(input())
    expect(text).toContain(
      'Return ONLY one JSON object with EXACTLY these keys: fullPrompt, operations, conflicts, warnings.'
    )
    expect(text).toContain('Every operations entry MUST use the key "op" (NOT "type")')
    expect(text).toContain('{"op":"add","block":BLOCK}')
    expect(text).toContain(
      '{"op":"replace","blockId":"<existing-id>","before":"<exact current text>","after":"<new text>"}'
    )
    expect(text).toContain('{"op":"setWeight","blockId":"<existing-id>","before":1.2,"after":1.5}')
    expect(text).toContain('{"op":"remove","blockId":"<existing-id>","before":"<exact current text>"}')
    expect(text).toContain(
      'BLOCK MUST have EXACTLY these keys: id, source, locked, category, label, text, weight, confidence, evidence, priority, requirementRefs, materialRefs.'
    )
    expect(text).toContain('conflicts MUST be an array of objects {"blockId":"<id>","message":"<text>"}')
    expect(text).toContain('evidence MUST be an array of objects')
    for (const source of PROMPT_SOURCES) expect(text).toContain(source)
    for (const category of PROMPT_CATEGORIES) expect(text).toContain(category)
  })

  it('reports invalid JSON with a stable reason', () => {
    let caught: unknown
    try {
      parsePromptSyncOutput('not json')
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(AppError)
    expect((caught as AppError).details).toMatchObject({ reason: 'invalid_json' })
    expect((caught as AppError).message).toContain('invalid_json')
  })

  it('reports schema failures with the reason and rejected issue paths', () => {
    const invalid = JSON.stringify({
      fullPrompt: '有效提示词',
      operations: [{ type: 'add', block: { id: 'subject.age' } }],
      conflicts: ['not an object'],
      warnings: []
    })
    let caught: unknown
    try {
      parsePromptSyncOutput(invalid)
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(AppError)
    const appError = caught as AppError
    expect(appError.code).toBe('PROMPT_SYNC_INVALID_OUTPUT')
    expect(appError.details).toMatchObject({ reason: 'schema_invalid' })
    expect(appError.message).toContain('schema_invalid')
    expect(appError.message).toContain('operations.0.op')
    expect((appError.details as { issues?: Array<{ path: string; code: string }> }).issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'operations.0.op', code: 'invalid_union_discriminator' })
      ])
    )
  })
})
