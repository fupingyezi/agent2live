import { describe, expect, it } from 'vitest'
import { computeProjectProgress } from './project-progress'

describe('computeProjectProgress', () => {
  it('starts at prompt work when neither version exists', () => {
    expect(
      computeProjectProgress({
        activePromptVersionId: null,
        activeVersionId: null
      })
    ).toEqual({
      percent: 0,
      promptDone: false,
      artDone: false,
      nextAction: 'prompt',
      nextLabel: '完善提示词'
    })
  })

  it('moves to generation after a prompt version is committed', () => {
    expect(
      computeProjectProgress({
        activePromptVersionId: 'pv_01J0000000000000000000000',
        activeVersionId: null
      })
    ).toEqual({
      percent: 50,
      promptDone: true,
      artDone: false,
      nextAction: 'generate',
      nextLabel: '生成候选'
    })
  })

  it('treats an active art version as the complete Phase 1 chain', () => {
    expect(
      computeProjectProgress({
        activePromptVersionId: null,
        activeVersionId: 'av_01J0000000000000000000000'
      })
    ).toEqual({
      percent: 100,
      promptDone: true,
      artDone: true,
      nextAction: 'review',
      nextLabel: '查看版本'
    })
  })
})
