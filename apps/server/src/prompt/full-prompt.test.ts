import { describe, expect, it } from 'vitest'
import { promptSpecSchema } from '@agent2live/contracts'
import { normalizeLegacyFullPrompt } from './full-prompt'
import { specFixture } from '../../tests/fixtures/spec'

describe('normalizeLegacyFullPrompt', () => {
  it('creates a stable full prompt for legacy block-only specs', () => {
    const spec = specFixture()
    spec.fullPrompt = ''
    const first = normalizeLegacyFullPrompt(spec)
    const second = normalizeLegacyFullPrompt(spec)

    expect(first.fullPrompt).toContain('银白长发的蓝眼少女')
    expect(first.fullPrompt).toContain('写实皮肤')
    expect(first.fullPrompt).toBe(second.fullPrompt)
    expect(first).not.toBe(spec)
  })

  it('preserves an existing full prompt', () => {
    const spec = specFixture()
    spec.fullPrompt = '一段用户已经编辑好的完整提示词。'
    expect(normalizeLegacyFullPrompt(spec).fullPrompt).toBe(spec.fullPrompt)
  })

  it('returns a schema-valid empty prompt when there are no blocks', () => {
    const empty = promptSpecSchema.parse({
      schemaVersion: 'prompt-spec/2',
      lockAll: false,
      sourceRequirements: [],
      materialRefs: [],
      blocks: [],
      negativeBlocks: [],
      constraints: {
        canvas: { width: 1024, height: 1792 },
        background: 'transparent',
        aspect: 'portrait'
      }
    })
    expect(normalizeLegacyFullPrompt(empty).fullPrompt).toBe('')
  })
})
