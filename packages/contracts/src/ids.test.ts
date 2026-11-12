import { describe, expect, it } from 'vitest'
import { ID_PREFIXES, isId, newId } from './ids'

describe('ids', () => {
  it('creates prefixed ULIDs per entity kind', () => {
    const id = newId('character')
    expect(id.startsWith(`${ID_PREFIXES.character}_`)).toBe(true)
    expect(id.slice(ID_PREFIXES.character.length + 1)).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/)
    expect(isId('character', id)).toBe(true)
  })

  it('rejects a valid ULID under the wrong prefix', () => {
    const id = newId('asset')
    expect(isId('character', id)).toBe(false)
    expect(isId('asset', id)).toBe(true)
  })

  it('rejects malformed IDs and injection-shaped values', () => {
    expect(isId('character', 'chr_')).toBe(false)
    expect(isId('character', 'chr_01J0I000000000000000000000')).toBe(false)
    expect(isId('character', 'chr_01J0/../../etc/passwd')).toBe(false)
    expect(isId('character', 'chr_01j0000000000000000000000')).toBe(false)
  })

  it('generates unique values in a tight loop', () => {
    const values = new Set(Array.from({ length: 2000 }, () => newId('job')))
    expect(values.size).toBe(2000)
  })
})
