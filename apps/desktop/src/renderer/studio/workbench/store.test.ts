import { beforeEach, describe, expect, it } from 'vitest'
import type { PromptSpecV2 } from '@agent2live/contracts'
import { useWorkbenchStore } from './store'

function spec(): PromptSpecV2 {
  return {
    schemaVersion: 'prompt-spec/2',
    lockAll: false,
    sourceRequirements: [{ id: 'req-1', text: '蓝色眼睛', strength: 'must' }],
    materialRefs: [],
    blocks: [
      {
        id: 'block-1',
        category: 'face',
        label: '眼睛',
        text: '蓝色眼睛',
        weight: 1,
        locked: false,
        confidence: 1,
        evidence: [],
        source: 'user',
        priority: 0,
        requirementRefs: ['req-1'],
        materialRefs: []
      }
    ],
    negativeBlocks: [],
    constraints: { canvas: { width: 1024, height: 1792 }, background: 'transparent', aspect: 'portrait' }
  }
}

function hydrate(state = spec()): void {
  useWorkbenchStore.getState().hydrate({
    draftId: 'draft_1',
    revision: 2,
    rowVersion: 5,
    draft: state
  })
}

beforeEach(() => {
  useWorkbenchStore.getState().reset()
})

describe('workbench store', () => {
  it('hydrates and edits an unlocked block', () => {
    hydrate()
    useWorkbenchStore.getState().updateBlock('block-1', { text: '冰蓝色眼睛' })
    const state = useWorkbenchStore.getState()
    expect(state.draft?.blocks[0]?.text).toBe('冰蓝色眼睛')
    expect(state.dirty).toBe(true)
    expect(state.rowVersion).toBe(5)
  })

  it('does not overwrite dirty edits on refetch', () => {
    hydrate()
    useWorkbenchStore.getState().updateBlock('block-1', { text: '本地修改' })
    hydrate({ ...spec(), blocks: [{ ...spec().blocks[0]!, text: '服务端变化' }] })
    expect(useWorkbenchStore.getState().draft?.blocks[0]?.text).toBe('本地修改')
  })

  it('blocks edits, weight changes, and removal on locked blocks', () => {
    hydrate()
    useWorkbenchStore.getState().toggleBlockLock('block-1')
    expect(() => useWorkbenchStore.getState().updateBlock('block-1', { text: '不应写入' })).toThrow(/locked/i)
    expect(() => useWorkbenchStore.getState().updateBlockWeight('block-1', 1.8)).toThrow(/locked/i)
    expect(() => useWorkbenchStore.getState().removeBlock('block-1')).toThrow(/locked/i)
    expect(useWorkbenchStore.getState().draft?.blocks[0]?.text).toBe('蓝色眼睛')
    expect(useWorkbenchStore.getState().draft?.blocks[0]?.weight).toBe(1)
  })

  it('toggles lockAll and cancels local changes', () => {
    hydrate()
    useWorkbenchStore.getState().updateBlock('block-1', { text: '改动' })
    useWorkbenchStore.getState().cancelLocalChanges()
    expect(useWorkbenchStore.getState().draft?.blocks[0]?.text).toBe('蓝色眼睛')
    expect(useWorkbenchStore.getState().dirty).toBe(false)
    useWorkbenchStore.getState().toggleLockAll()
    expect(useWorkbenchStore.getState().draft?.lockAll).toBe(true)
  })

  it('marks a saved revision clean and replaces its base row version', () => {
    hydrate()
    useWorkbenchStore.getState().updateBlock('block-1', { text: '新文本' })
    const draft = useWorkbenchStore.getState().draft!
    useWorkbenchStore.getState().markSaved(draft, 6, 3)
    expect(useWorkbenchStore.getState().dirty).toBe(false)
    expect(useWorkbenchStore.getState().rowVersion).toBe(6)
    expect(useWorkbenchStore.getState().revision).toBe(3)
  })

  it('cancelLocalChanges restores the saved draft snapshot', () => {
    const draft = spec()
    hydrate(draft)
    useWorkbenchStore.getState().updateBlock('block-1', { text: '本地未保存修改' })
    expect(useWorkbenchStore.getState().dirty).toBe(true)

    useWorkbenchStore.getState().cancelLocalChanges()

    const after = useWorkbenchStore.getState()
    expect(after.dirty).toBe(false)
    expect(after.draft?.blocks[0]?.text).toBe('蓝色眼睛')
  })

  it('updates requirement/material references and refuses locked blocks', () => {
    const draft = spec()
    hydrate(draft)
    useWorkbenchStore.getState().updateBlockReferences('block-1', { requirementRefs: [] })
    expect(useWorkbenchStore.getState().draft?.blocks[0]?.requirementRefs).toEqual([])

    useWorkbenchStore.getState().toggleBlockLock('block-1')
    expect(() =>
      useWorkbenchStore.getState().updateBlockReferences('block-1', {
        requirementRefs: ['req-1']
      })
    ).toThrow('block is locked')
  })
})
