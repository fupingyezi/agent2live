import { describe, expect, it } from 'vitest'
import { formatBytes, formatPercent } from './format'

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

describe('formatBytes', () => {
  it('renders missing and invalid sizes as an em dash', () => {
    expect(formatBytes(null)).toBe('—')
    expect(formatBytes(Number.NaN)).toBe('—')
    expect(formatBytes(-1)).toBe('—')
  })

  it('renders bytes, kilobytes, and megabytes without scaling errors', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(1023)).toBe('1023 B')
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB')
    expect(formatBytes(3 * 1024 * 1024 + 512 * 1024)).toBe('3.5 MB')
  })
})
