import { describe, expect, it } from 'vitest'
import { assertActiveVersion, parseActiveMatch, parseIfMatch, requireIfMatch } from '../src/http/conditional'

describe('If-Match', () => {
  it('accepts quoted and bare row versions', () => {
    expect(parseIfMatch('"3"')).toBe(3)
    expect(parseIfMatch('3')).toBe(3)
    expect(parseIfMatch('W/"3"')).toBe(3)
  })

  it('rejects malformed values and missing headers upstream', () => {
    expect(() => parseIfMatch(undefined)).toThrow(expect.objectContaining({ code: 'PRECONDITION_REQUIRED' }))
    expect(() => parseIfMatch('*')).toThrow(expect.objectContaining({ code: 'REQUEST_INVALID' }))
    expect(() => parseIfMatch('0')).toThrow(expect.objectContaining({ code: 'REQUEST_INVALID' }))
    expect(() => parseIfMatch('abc')).toThrow(expect.objectContaining({ code: 'REQUEST_INVALID' }))
  })

  it('models none for empty active pointer', () => {
    expect(parseActiveMatch('none')).toBeNull()
    expect(parseActiveMatch('"av_01J00000000000000000000000"')).toBe('av_01J00000000000000000000000')
  })

  it('requires the expected row version to match the stored one', () => {
    expect(requireIfMatch('"2"', 2)).toBe(2)
    expect(() => requireIfMatch('"2"', 3)).toThrow(expect.objectContaining({ code: 'ROW_VERSION_CONFLICT' }))
  })

  it('rejects a changed active version', () => {
    expect(() => assertActiveVersion(null, 'av_01J00000000000000000000000')).toThrow(
      expect.objectContaining({ code: 'ART_ACTIVE_VERSION_CHANGED' })
    )
    expect(() => assertActiveVersion('av_01J00000000000000000000000', null)).toThrow(
      expect.objectContaining({ code: 'ART_ACTIVE_VERSION_CHANGED' })
    )
    expect(() => assertActiveVersion(null, null)).not.toThrow()
  })
})
