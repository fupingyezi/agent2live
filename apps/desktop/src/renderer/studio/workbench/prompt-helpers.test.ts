import { describe, expect, it } from 'vitest'
import { promptSpecSchema } from '@agent2live/contracts/prompt'
import type { PromptSpecV2 } from '@agent2live/contracts'
import {
  makePromptBlock,
  removeBlock,
  removeRequirement,
  toCoreSpec,
  uncoveredRequirementIds,
  validatePromptForSave
} from './prompt-helpers'

function baseSpec(): PromptSpecV2 {
  return {
    schemaVersion: 'prompt-spec/2',
    lockAll: false,
    sourceRequirements: [
      { id: 'req-hair', text: '黑色长发', strength: 'must' },
      { id: 'req-color', text: '不要高饱和背景', strength: 'avoid' }
    ],
    materialRefs: [],
    blocks: [
      {
        id: 'block-hair',
        category: 'hair',
        label: '头发',
        text: '黑色长发',
        weight: 1,
        locked: false,
        confidence: 1,
        evidence: [],
        source: 'user',
        priority: 0,
        requirementRefs: ['req-hair'],
        materialRefs: []
      }
    ],
    negativeBlocks: [
      {
        id: 'block-negative',
        category: 'negative',
        label: '背景',
        text: '高饱和背景',
        weight: 1,
        locked: false,
        confidence: 1,
        evidence: [],
        source: 'user',
        priority: 0,
        requirementRefs: ['req-color'],
        materialRefs: []
      }
    ],
    constraints: { canvas: { width: 1024, height: 1792 }, background: 'transparent', aspect: 'portrait' }
  }
}

describe('toCoreSpec', () => {
  it('drops runtime metadata but keeps a schema-valid prompt spec', () => {
    const spec = {
      ...baseSpec(),
      promptVersionId: 'pv_1',
      artProjectId: 'artp_1',
      contentHash: 'a'.repeat(64)
    } as PromptSpecV2
    const core = toCoreSpec(spec)
    expect(core).not.toHaveProperty('promptVersionId')
    expect(core).not.toHaveProperty('artProjectId')
    expect(promptSpecSchema.parse(core)).toEqual(baseSpec())
  })
})

describe('removeRequirement', () => {
  it('cascades references from unlocked blocks', () => {
    const next = removeRequirement(baseSpec(), 'req-hair')
    expect(next.sourceRequirements.map((item) => item.id)).toEqual(['req-color'])
    expect(next.blocks[0]!.requirementRefs).toEqual([])
  })

  it('refuses to mutate a locked referencing block', () => {
    const spec = baseSpec()
    spec.blocks[0]!.locked = true
    expect(() => removeRequirement(spec, 'req-hair')).toThrow(/locked/i)
  })
})

describe('removeBlock', () => {
  it('refuses to remove a locked block or any block while lockAll is true', () => {
    const spec = baseSpec()
    spec.blocks[0]!.locked = true
    expect(() => removeBlock(spec, 'block-hair')).toThrow(/locked/i)
    const allLocked = { ...baseSpec(), lockAll: true }
    expect(() => removeBlock(allLocked, 'block-hair')).toThrow(/locked/i)
  })
})

describe('validatePromptForSave', () => {
  it('reports empty text and unknown requirement refs before hitting the server', () => {
    const spec = baseSpec()
    spec.blocks[0]!.text = ''
    expect(validatePromptForSave(spec)).toMatch(/text/i)
    const broken = baseSpec()
    broken.blocks[0]!.requirementRefs = ['missing']
    expect(validatePromptForSave(broken)).toMatch(/unknown requirement/i)
  })

  it('accepts a valid spec', () => {
    expect(validatePromptForSave(baseSpec())).toBeNull()
  })
})

describe('uncoveredRequirementIds', () => {
  it('requires must on positive blocks and avoid on negative blocks', () => {
    expect(uncoveredRequirementIds(baseSpec())).toEqual([])
    const spec = baseSpec()
    spec.blocks[0]!.requirementRefs = []
    expect(uncoveredRequirementIds(spec)).toEqual(['req-hair'])
  })
})

describe('makePromptBlock', () => {
  it('creates schema-valid user blocks with safe local ids', () => {
    const block = makePromptBlock(false)
    expect(block.id).toMatch(/^block-[a-f0-9-]+$/)
    expect(block.locked).toBe(false)
    expect(block.source).toBe('user')
    expect(block.text.trim().length).toBeGreaterThan(0)
  })
})
