import { describe, expect, it } from 'vitest'
import { hashCanonical } from './hash'
import {
  characterBriefContentSchema,
  characterBriefVersionSchema,
  createCharacterBriefVersionInputSchema,
  isMeaningfulCharacterBrief
} from './character-brief'

const minimal = {
  schemaVersion: 'character-brief/1' as const,
  identity: { fullName: '檐上霜' },
  background: { summary: '住在旧城屋檐上的铸剑师，替人修补断刃。' },
  appearance: { defaultPose: '正面站姿，双手垂在身前' }
}

describe('CharacterBrief contract', () => {
  it('fills empty sections with stable defaults', () => {
    const parsed = characterBriefContentSchema.parse(minimal)
    expect(parsed.schemaVersion).toBe('character-brief/1')
    expect(parsed.identity.aliases).toEqual([])
    expect(parsed.personality.traits).toEqual([])
    expect(parsed.relationships.entries).toEqual([])
    expect(parsed.notes).toBe('')
    expect(isMeaningfulCharacterBrief(parsed)).toBe(true)
  })

  it('canonical hash ignores key order but changes with content', () => {
    const a = characterBriefContentSchema.parse(minimal)
    const b = characterBriefContentSchema.parse({
      appearance: { defaultPose: '正面站姿，双手垂在身前' },
      background: { summary: '住在旧城屋檐上的铸剑师，替人修补断刃。' },
      schemaVersion: 'character-brief/1',
      identity: { fullName: '檐上霜' }
    })
    expect(hashCanonical(a)).toBe(hashCanonical(b))
    expect(hashCanonical(a)).not.toBe(hashCanonical({ ...a, identity: { ...a.identity, fullName: '砚' } }))
  })

  it('rejects an empty or whitespace-only brief', () => {
    expect(
      isMeaningfulCharacterBrief(characterBriefContentSchema.parse({ schemaVersion: 'character-brief/1' }))
    ).toBe(false)
    expect(() =>
      createCharacterBriefVersionInputSchema.parse({
        content: { schemaVersion: 'character-brief/1', notes: '   ' }
      })
    ).toThrow(/meaningful/i)
  })

  it('rejects unknown fields and overlong text', () => {
    expect(() => characterBriefContentSchema.parse({ ...minimal, hiddenPrompt: 'x' })).toThrow()
    expect(() =>
      characterBriefContentSchema.parse({
        ...minimal,
        notes: 'x'.repeat(8001)
      })
    ).toThrow()
  })

  it('supports an optional parent and CAS pointer', () => {
    const parsed = createCharacterBriefVersionInputSchema.parse({
      content: minimal,
      parentVersionId: 'cbv_01J00000000000000000000000',
      expectedActiveBriefVersionId: null,
      sourceKind: 'user'
    })
    expect(parsed.sourceKind).toBe('user')
    expect(parsed.expectedActiveBriefVersionId).toBeNull()
  })

  it('exposes a version DTO with a 64-hex content hash', () => {
    const version = characterBriefVersionSchema.parse({
      id: 'cbv_01J00000000000000000000000',
      characterId: 'chr_01J00000000000000000000000',
      parentVersionId: null,
      schemaVersion: 'character-brief/1',
      content: minimal,
      contentHash: 'a'.repeat(64),
      sourceKind: 'user',
      createdAt: 1_760_000_000_000
    })
    expect(version.content.identity.fullName).toBe('檐上霜')
  })
})
