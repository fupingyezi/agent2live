import { describe, expect, it } from 'vitest'
import { modelUrlFromSearch } from '@renderer/shared'

describe('modelUrlFromSearch', () => {
  it('returns the decoded model query parameter', () => {
    const modelUrl = 'agent2live-model://models/Haru/Haru.model3.json'
    expect(modelUrlFromSearch(`?model=${encodeURIComponent(modelUrl)}`)).toBe(modelUrl)
  })

  it('returns null when the query is missing or empty', () => {
    expect(modelUrlFromSearch('')).toBeNull()
    expect(modelUrlFromSearch('?other=1')).toBeNull()
    expect(modelUrlFromSearch('?model=')).toBeNull()
  })
})
