import { describe, expect, it } from 'vitest'
import type { PromptBlock, PromptSpecV2 } from '@studio/api'
import {
  blockLabelById,
  isPendingBlock,
  promptBlockGroups,
  promptFilterModel,
  shadowedBlockIds
} from './prompt-diagnostics'

function block(id: string, category: PromptBlock['category'], label: string, text = '内容'): PromptBlock {
  return {
    id,
    category,
    label,
    text,
    weight: 1,
    locked: false,
    confidence: 1,
    evidence: [],
    source: 'user',
    priority: 0,
    requirementRefs: [],
    materialRefs: []
  }
}

function spec(): PromptSpecV2 {
  return {
    schemaVersion: 'prompt-spec/2',
    fullPrompt: '',
    lockAll: false,
    sourceRequirements: [],
    materialRefs: [],
    blocks: [
      block('hair.a', 'hair', '发色'),
      block('hair.b', 'hair', '发色'),
      block('face.pending', 'face', '神情', '待填写'),
      block('outfit.locked', 'outfit', '旗袍'),
      block('style.a', 'style', '风格')
    ],
    negativeBlocks: [block('negative.avoid', 'negative', '排除', '蕾丝')],
    constraints: { canvas: { width: 1024, height: 1792 }, background: 'transparent', aspect: 'portrait' }
  }
}

describe('prompt diagnostics', () => {
  it('counts categories and statuses', () => {
    const model = promptFilterModel(spec())
    expect(model.total).toBe(6)
    expect(model.categories.map((item) => [item.id, item.count])).toEqual([
      ['face', 1],
      ['hair', 2],
      ['outfit', 1],
      ['style', 1],
      ['negative', 1]
    ])
    expect(model.statuses.map((item) => [item.id, item.count])).toEqual([
      ['pending', 1],
      ['shadowed', 1]
    ])
  })

  it('marks duplicate category+label blocks except the last as shadowed', () => {
    expect([...shadowedBlockIds(spec())]).toEqual(['hair.a'])
    expect(isPendingBlock(block('face.pending', 'face', '神情', '待填写'))).toBe(true)
  })

  it('groups blocks by category and filters by category or status', () => {
    expect(promptBlockGroups(spec(), 'all').map((group) => [group.id, group.blocks.length])).toEqual([
      ['face', 1],
      ['hair', 2],
      ['outfit', 1],
      ['style', 1],
      ['negative', 1]
    ])
    expect(promptBlockGroups(spec(), 'hair').map((group) => group.id)).toEqual(['hair'])
    expect(promptBlockGroups(spec(), 'pending').map((group) => group.id)).toEqual(['face'])
    expect(
      promptBlockGroups(spec(), 'shadowed').flatMap((group) => group.blocks.map((entry) => entry.id))
    ).toEqual(['hair.a'])
    expect(promptBlockGroups(spec(), 'negative').map((group) => group.id)).toEqual(['negative'])
  })

  it('looks up block labels with a raw-id fallback', () => {
    expect(blockLabelById('hair.a', spec())).toBe('发色')
    expect(blockLabelById('missing', spec())).toBe('未知条目')
  })
})
