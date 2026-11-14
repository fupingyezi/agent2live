import { describe, expect, it } from 'vitest'
import { buildReverseState, parseReverseOutput } from '../src/prompt/reverse'
import { specFixture } from './fixtures/spec'
import type { PromptInputSubmissionDto } from '../src/services/prompt-submissions'

const requirements = [
  { id: 'req_identity', text: '银白长发与蓝色眼睛', strength: 'must' as const },
  { id: 'req_style', text: '清爽赛璐璐', strength: 'prefer' as const },
  { id: 'req_avoid', text: '避免写实皮肤', strength: 'avoid' as const }
]
const lockedAssetId = 'ast_01J00000000000000000000000'
const materials = [
  {
    id: 'alink_1',
    assetId: lockedAssetId,
    role: 'identity_reference' as const,
    note: '脸型',
    weight: 1,
    locked: true,
    sortOrder: 0
  }
]
const submission: PromptInputSubmissionDto = {
  id: 'pin_01J00000000000000000000000',
  artProjectId: 'artp_1',
  draftId: 'pd_1',
  revision: 1,
  characterBriefVersionId: null,
  globalNotes: '清透',
  requirements,
  materials
}

function output(overrides: Record<string, unknown> = {}) {
  return {
    blocks: [
      {
        id: 'subject.identity',
        category: 'subject',
        label: '人物身份',
        text: '银白长发与蓝色眼睛',
        weight: 1.2,
        locked: false,
        confidence: 0.8,
        evidence: [{ assetId: lockedAssetId }],
        source: 'vision-model',
        priority: 100,
        requirementRefs: ['req_identity'],
        materialRefs: [lockedAssetId]
      },
      {
        id: 'outfit.detail',
        category: 'outfit',
        label: '服装',
        text: '白色连衣裙',
        weight: 1,
        locked: false,
        confidence: 0.8,
        evidence: [],
        source: 'vision-model',
        priority: 50,
        requirementRefs: [],
        materialRefs: [lockedAssetId]
      },
      {
        id: 'style.rendering',
        category: 'style',
        label: '风格',
        text: '清爽赛璐璐',
        weight: 1,
        locked: false,
        confidence: 0.8,
        evidence: [],
        source: 'vision-model',
        priority: 50,
        requirementRefs: ['req_style'],
        materialRefs: []
      }
    ],
    negativeBlocks: [
      {
        id: 'negative.avoid',
        category: 'negative',
        label: '避免项',
        text: '避免写实皮肤',
        weight: 1,
        locked: false,
        confidence: 0.8,
        evidence: [],
        source: 'vision-model',
        priority: 0,
        requirementRefs: ['req_avoid'],
        materialRefs: []
      }
    ],
    warnings: [],
    ...overrides
  }
}

describe('prompt reverse parsing', () => {
  it('accepts plain JSON and fenced JSON', () => {
    expect(parseReverseOutput(JSON.stringify(output())).blocks).toHaveLength(3)
    expect(parseReverseOutput('```json\n' + JSON.stringify(output()) + '\n```').blocks).toHaveLength(3)
  })

  it('maps invalid JSON and policy violations to PROMPT_REVERSE_INVALID_OUTPUT', () => {
    expect(() => parseReverseOutput('not json')).toThrow(
      expect.objectContaining({ code: 'PROMPT_REVERSE_INVALID_OUTPUT' })
    )
    const locked = output() as { blocks: Array<Record<string, unknown>> }
    locked.blocks[0]!.locked = true
    expect(() => parseReverseOutput(JSON.stringify(locked))).toThrow(
      expect.objectContaining({ code: 'PROMPT_REVERSE_INVALID_OUTPUT' })
    )
  })

  it('preserves locked base blocks and derives locks from locked materials', () => {
    const base = specFixture()
    base.blocks[0]!.locked = true
    base.blocks[0]!.text = '用户锁定的身份'
    const state = buildReverseState(base, submission, parseReverseOutput(JSON.stringify(output())))
    expect(
      state.blocks.some((block) => block.id === 'subject.identity' && block.text === '用户锁定的身份')
    ).toBe(true)
    expect(state.blocks.filter((block) => block.id === 'subject.identity')).toHaveLength(1)
    expect(state.blocks.find((block) => block.id === 'outfit.detail')?.locked).toBe(true)
    expect(state.blocks.find((block) => block.id === 'style.rendering')?.locked).toBe(false)
    expect(state.negativeBlocks.some((block) => block.id === 'negative.realism')).toBe(true)
    expect(state.sourceRequirements).toEqual(requirements)
    expect(state.materialRefs[0]?.assetId).toBe(lockedAssetId)
    expect(state.characterBriefVersionId).toBeNull()
  })

  it('rejects output that leaves a must or avoid requirement uncovered', () => {
    const extra = {
      ...submission,
      requirements: [...requirements, { id: 'req_extra', text: '手持纸伞', strength: 'must' as const }]
    }
    expect(() =>
      buildReverseState(specFixture(), extra, parseReverseOutput(JSON.stringify(output())))
    ).toThrow(expect.objectContaining({ code: 'PROMPT_REVERSE_INVALID_OUTPUT' }))
  })
})
