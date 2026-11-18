import { describe, expect, it } from 'vitest'
import { parseWorkbenchView, updateWorkbenchView } from './view-state'

describe('workbench view state', () => {
  it('defaults to the prompt view and reads ids from the URL', () => {
    expect(parseWorkbenchView(new URLSearchParams())).toEqual({
      view: 'prompt',
      promptVersionId: null,
      artVersionId: null,
      generationId: null
    })
    expect(
      parseWorkbenchView(
        new URLSearchParams('view=candidates&version=pv_1&artVersion=av_1&generation=gen_1&project=p_1')
      )
    ).toEqual({
      view: 'candidates',
      promptVersionId: 'pv_1',
      artVersionId: 'av_1',
      generationId: 'gen_1'
    })
  })

  it('falls back to prompt for unknown views', () => {
    expect(parseWorkbenchView(new URLSearchParams('view=unknown')).view).toBe('prompt')
  })

  it('updates and clears only the supplied view parameters', () => {
    const current = new URLSearchParams('project=p_1&view=prompt&aiKind=suggest&artVersion=av_1')
    const next = updateWorkbenchView(current, {
      view: 'versions',
      artVersionId: 'av_2',
      promptVersionId: 'pv_2'
    })
    expect(next.get('project')).toBe('p_1')
    expect(next.get('aiKind')).toBe('suggest')
    expect(next.get('view')).toBe('versions')
    expect(next.get('artVersion')).toBe('av_2')
    expect(next.get('version')).toBe('pv_2')

    const cleared = updateWorkbenchView(next, {
      view: 'prompt',
      artVersionId: null,
      promptVersionId: null
    })
    expect(cleared.get('view')).toBeNull()
    expect(cleared.get('artVersion')).toBeNull()
    expect(cleared.get('version')).toBeNull()
  })
})
