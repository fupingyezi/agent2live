import { describe, expect, it } from 'vitest'
import type { ImageCapabilityProfile } from '@agent2live/contracts'
import { compilePrompt, specContentHash, specCoreOf } from '../src/prompt/compile'
import { normalizeText } from '../src/prompt/normalize'
import { specFixture } from './fixtures/spec'

const capability: ImageCapabilityProfile = {
  maxReferenceImages: 4,
  maxPromptChars: 400,
  supportsNegativePrompt: true,
  supportsWeightSyntax: true,
  supportsSeed: true,
  maxCount: 4,
  sizes: ['512x896']
}

describe('compilePrompt', () => {
  it('is deterministic and orders by category then priority then id', () => {
    const spec = specFixture()
    const first = compilePrompt(spec, capability)
    const second = compilePrompt(spec, capability)
    expect(first).toEqual(second)
    const subject = '银白长发的蓝眼少女，正视半身'
    const style = '清爽的日系赛璐璐插画，干净线稿'
    const background = '淡蓝色渐变背景'
    expect(first.prompt.indexOf(subject)).toBeLessThan(first.prompt.indexOf(style))
    expect(first.prompt.indexOf(style)).toBeLessThan(first.prompt.indexOf(background))
    expect(first.negativePrompt).toContain('写实皮肤')
    expect(first.prompt).not.toContain('写实皮肤')
    expect(first.prompt).not.toMatch(/\s{2,}/)
  })

  it('emits emphasis only when supportsWeightSyntax is true', () => {
    const spec = specFixture()
    spec.blocks = spec.blocks.map((block) =>
      block.id === 'style.rendering' ? { ...block, weight: 2 } : block
    )
    const weighted = compilePrompt(spec, capability)
    expect(weighted.prompt).toContain('(清爽的日系赛璐璐插画，干净线稿):2.0')

    const plain = compilePrompt(spec, { ...capability, supportsWeightSyntax: false })
    expect(plain.prompt).not.toContain('(清爽的日系赛璐璐插画，干净线稿)')
    expect(plain.prompt).toContain('清爽的日系赛璐璐插画，干净线稿')
    expect(plain.warnings).toContain('weights_not_supported')
  })

  it('folds negative blocks into the positive prompt when unsupported', () => {
    const compiled = compilePrompt(specFixture(), { ...capability, supportsNegativePrompt: false })
    expect(compiled.negativePrompt).toBe('')
    expect(compiled.prompt).toContain('Avoid: 写实皮肤、照片质感、厚涂')
    expect(compiled.warnings).toContain('negative_prompt_folded')
  })

  it('drops only optional low-priority blocks and reports their ids', () => {
    const spec = specFixture()
    for (let index = 0; index < 12; index += 1) {
      spec.blocks.push({
        id: `other.extra_${index}`,
        category: 'other',
        label: `extra ${index}`,
        text: 'x'.repeat(80),
        weight: 1,
        locked: false,
        confidence: 0.1,
        evidence: [],
        source: 'ai-suggestion',
        priority: 10,
        requirementRefs: [],
        materialRefs: []
      })
    }
    const compiled = compilePrompt(spec, { ...capability, maxPromptChars: 160 })
    expect(compiled.truncated).toBe(true)
    expect(compiled.promptLength).toBeLessThanOrEqual(160)
    expect(compiled.prompt).toContain('银白长发的蓝眼少女')
    expect(compiled.droppedBlockIds.length).toBeGreaterThan(0)
    expect(compiled.warnings).toContain('truncated')
  })

  it('keeps mandatory content over the limit and reports it instead of dropping it', () => {
    const spec = specFixture()
    spec.blocks[0]!.text = '银'.repeat(300)
    const compiled = compilePrompt(spec, { ...capability, maxPromptChars: 10 })
    expect(compiled.prompt).toContain('银'.repeat(300))
    expect(compiled.promptLength).toBeGreaterThan(10)
    expect(compiled.warnings).toContain('mandatory_content_exceeds_limit')
  })

  it('never drops must blocks under prompt pressure', () => {
    const spec = specFixture()
    const base = spec.blocks[1]!
    spec.blocks = [
      {
        ...base,
        id: 'hair.must',
        category: 'hair',
        label: '发型',
        text: '银白长发'.repeat(6),
        strength: 'must',
        locked: false,
        priority: 1
      },
      {
        ...base,
        id: 'style.prefer',
        category: 'style',
        label: '风格',
        text: '超长风格描述'.repeat(20),
        strength: 'prefer',
        locked: false,
        priority: 2
      }
    ]
    spec.negativeBlocks = []
    const compiled = compilePrompt(spec, {
      ...capability,
      maxPromptChars: 20,
      supportsNegativePrompt: false
    })
    expect(compiled.truncated).toBe(true)
    expect(compiled.prompt).toContain('银白长发')
    expect(compiled.droppedBlockIds).toContain('style.prefer')
    expect(compiled.droppedBlockIds).not.toContain('hair.must')
    expect(compiled.warnings).toContain('mandatory_content_exceeds_limit')
  })

  it('hashes only stable spec content', () => {
    const spec = specFixture()
    const baseline = specContentHash(spec)
    const withRuntimeIds = {
      ...spec,
      promptVersionId: 'pv_01J00000000000000000000000',
      artProjectId: 'artp_01J00000000000000000000000',
      characterId: 'chr_01J00000000000000000000000',
      contentHash: 'f'.repeat(64)
    }
    expect(specContentHash(withRuntimeIds)).toBe(baseline)
    expect(specContentHash({ ...spec, blocks: [...spec.blocks].reverse() })).not.toBe(baseline)
  })

  it('includes fullPrompt in the canonical core and content hash', () => {
    const spec = specFixture()
    const baseline = specContentHash(spec)
    spec.fullPrompt = '另一段完整提示词。'
    expect(specCoreOf(spec).fullPrompt).toBe(spec.fullPrompt)
    expect(specContentHash(spec)).not.toBe(baseline)
  })
})

describe('normalizeText', () => {
  it('collapses full-width spaces, tabs, newlines, and CRLF to single ASCII spaces', () => {
    expect(normalizeText('银白　长发\t少女\n正视\r\n半身')).toBe('银白 长发 少女 正视 半身')
  })

  it('trims surrounding whitespace', () => {
    expect(normalizeText(' \t\n银白长发　')).toBe('银白长发')
  })

  it('returns normalized output without mutating the input', () => {
    const input = '  银白\t长发  '
    expect(normalizeText(input)).toBe('银白 长发')
    expect(input).toBe('  银白\t长发  ')
  })
})
