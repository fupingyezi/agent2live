import { describe, expect, it } from 'vitest'
import { formatPercent } from './format'

describe('formatPercent', () => {
  it('renders zero as 0%', () => {
    expect(formatPercent(0)).toBe('0%')
  })

  it('renders the server percent value without scaling it', () => {
    expect(formatPercent(10)).toBe('10%')
    expect(formatPercent(10)).not.toBe('1000%')
  })

  it('rounds to the nearest whole percent', () => {
    expect(formatPercent(99.6)).toBe('100%')
  })

  it('clamps values above 100', () => {
    expect(formatPercent(150)).toBe('100%')
  })

  it('clamps negative values', () => {
    expect(formatPercent(-3)).toBe('0%')
  })
})
