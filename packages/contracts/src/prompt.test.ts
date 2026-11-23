import { describe, expect, it } from 'vitest'
import {
  effectiveBlockStrength,
  promptReverseOutputSchema,
  promptSpecSchema,
  promptSuggestionOutputSchema,
  providerCapabilitiesSchema,
  savePromptDraftInputSchema
} from './prompt'
import { hashCanonical } from './hash'

const spec = {
  schemaVersion: 'prompt-spec/2',
  fullPrompt: '银白长发的蓝眼少女，正视半身，清爽的日系赛璐璐插画。',
  lockAll: false,
  sourceRequirements: [
    { id: 'req_identity', text: '银白长发与蓝色眼睛', strength: 'must' },
    { id: 'req_style', text: '清爽赛璐璐', strength: 'prefer' },
    { id: 'req_avoid', text: '避免写实皮肤', strength: 'avoid' }
  ],
  materialRefs: [
    {
      assetId: 'ast_01J00000000000000000000000',
      role: 'identity_reference',
      note: '脸型参考',
      weight: 1.4,
      locked: true
    },
    {
      assetId: 'ast_01J00000000000000000000001',
      role: 'style_reference',
      note: '色彩参考',
      weight: 0.9,
      locked: false
    }
  ],
  blocks: [
    {
      id: 'subject.identity',
      category: 'subject',
      label: '人物身份',
      text: '银白长发的蓝眼少女，正视半身',
      weight: 1.3,
      locked: true,
      confidence: 0.95,
      evidence: [{ assetId: 'ast_01J00000000000000000000000' }],
      source: 'vision-model',
      priority: 100,
      requirementRefs: ['req_identity'],
      materialRefs: ['ast_01J00000000000000000000000']
    },
    {
      id: 'style.rendering',
      category: 'style',
      label: '渲染风格',
      text: '清爽的日系赛璐璐插画，干净线稿',
      weight: 1.0,
      locked: false,
      confidence: 0.8,
      evidence: [],
      source: 'vision-model',
      priority: 80,
      requirementRefs: ['req_style'],
      materialRefs: ['ast_01J00000000000000000000001']
    }
  ],
  negativeBlocks: [
    {
      id: 'negative.realism',
      category: 'negative',
      label: '禁止写实',
      text: '写实皮肤、照片质感、厚涂',
      weight: 1.0,
      locked: true,
      confidence: 1,
      evidence: [],
      source: 'user',
      priority: 100,
      requirementRefs: ['req_avoid'],
      materialRefs: []
    }
  ],
  constraints: { canvas: { width: 1024, height: 1792 }, background: 'transparent', aspect: 'portrait' }
}

describe('PromptSpecV2', () => {
  it('accepts a complete spec and canonical-hashes stably', () => {
    const parsed = promptSpecSchema.parse(spec)
    expect(parsed.schemaVersion).toBe('prompt-spec/2')
    expect(parsed.fullPrompt).toBe(spec.fullPrompt)
    expect(hashCanonical(parsed)).toBe(hashCanonical({ ...spec, blocks: [...spec.blocks] }))
  })

  it('defaults missing fullPrompt to an empty string for legacy data', () => {
    const { fullPrompt: _fullPrompt, ...legacy } = spec
    expect(promptSpecSchema.parse(legacy).fullPrompt).toBe('')
  })

  it('limits fullPrompt to 20,000 characters', () => {
    expect(() => promptSpecSchema.parse({ ...spec, fullPrompt: '画'.repeat(20_001) })).toThrow()
  })

  it('rejects duplicate block IDs across positive and negative blocks', () => {
    const bad = {
      ...spec,
      negativeBlocks: [{ ...spec.negativeBlocks[0], id: 'subject.identity' }]
    }
    expect(() => promptSpecSchema.parse(bad)).toThrow(/duplicate/i)
  })

  it('rejects unknown requirement and material references', () => {
    const bad = {
      ...spec,
      blocks: [{ ...spec.blocks[0], requirementRefs: ['req_missing'] }]
    }
    expect(() => promptSpecSchema.parse(bad)).toThrow(/requirement/i)
  })

  it('requires avoid requirements only on negative blocks', () => {
    const bad = {
      ...spec,
      blocks: [{ ...spec.blocks[0], requirementRefs: ['req_identity', 'req_avoid'] }]
    }
    expect(() => promptSpecSchema.parse(bad)).toThrow(/avoid/i)
  })

  it('clamps weights and rejects empty text', () => {
    expect(() =>
      promptSpecSchema.parse({
        ...spec,
        blocks: [{ ...spec.blocks[0], weight: 0 }]
      })
    ).toThrow()
    expect(() =>
      promptSpecSchema.parse({
        ...spec,
        blocks: [{ ...spec.blocks[0], text: '   ' }]
      })
    ).toThrow()
  })

  it('rejects extra fields on commands', () => {
    expect(() => savePromptDraftInputSchema.parse({ state: spec, prompt: 'extra' })).toThrow()
  })

  it('accepts brief-derived blocks and a fixed brief version', () => {
    const parsed = promptSpecSchema.parse({
      ...spec,
      characterBriefVersionId: 'cbv_01J00000000000000000000000',
      blocks: [
        ...spec.blocks,
        {
          ...spec.blocks[0],
          id: 'brief.appearance.hair',
          source: 'character-brief',
          label: '发色',
          text: '银白长发',
          locked: true,
          confidence: 1,
          evidence: [],
          requirementRefs: [],
          materialRefs: []
        }
      ]
    })
    expect(parsed.characterBriefVersionId).toBe('cbv_01J00000000000000000000000')
    expect(parsed.blocks.at(-1)?.source).toBe('character-brief')
  })

  it('validates AI operations and forbids locked added blocks', () => {
    expect(
      promptSuggestionOutputSchema.parse({
        operations: [
          {
            op: 'replace',
            blockId: 'style.rendering',
            before: 'old',
            after: 'new',
            reason: '更清爽'
          },
          { op: 'setWeight', blockId: 'style.rendering', before: 1, after: 1.2 },
          { op: 'add', block: { ...spec.blocks[1], id: 'style.line', text: '细线', locked: false } },
          { op: 'remove', blockId: 'style.rendering', before: 'new' }
        ]
      }).operations
    ).toHaveLength(4)
    expect(() =>
      promptSuggestionOutputSchema.parse({
        operations: [{ op: 'add', block: { ...spec.blocks[1], id: 'style.locked', locked: true } }]
      })
    ).toThrow()
    expect(() =>
      promptSuggestionOutputSchema.parse({
        operations: [{ op: 'replace', blockId: 'x', before: 'a', after: 'a' }]
      })
    ).toThrow(/no-op|unchanged/i)
  })

  it('accepts blocks without strength and rejects avoid on positive blocks', () => {
    const parsed = promptSpecSchema.parse(spec)
    expect(parsed.blocks[0]?.strength).toBeUndefined()
    expect(parsed.negativeBlocks[0]?.strength).toBeUndefined()

    const must = promptSpecSchema.parse({
      ...spec,
      blocks: [{ ...spec.blocks[0], strength: 'must' }]
    })
    expect(must.blocks[0]?.strength).toBe('must')

    expect(() =>
      promptSpecSchema.parse({
        ...spec,
        blocks: [{ ...spec.blocks[0], strength: 'avoid' }]
      })
    ).toThrow(/avoid/i)
  })

  it('normalizes effective block strength for positive and negative blocks', () => {
    const positive = { ...spec.blocks[0]!, strength: undefined }
    const negative = { ...spec.negativeBlocks[0]!, strength: undefined }
    expect(effectiveBlockStrength(positive, false)).toBe('prefer')
    expect(effectiveBlockStrength({ ...positive, strength: 'must' }, false)).toBe('must')
    expect(effectiveBlockStrength(negative, true)).toBe('avoid')
    expect(effectiveBlockStrength({ ...positive, strength: 'prefer' }, true)).toBe('avoid')
  })
})

describe('provider capabilities', () => {
  it('requires supportsWeightSyntax on image profiles', () => {
    const profile = {
      maxReferenceImages: 4,
      maxPromptChars: 4000,
      supportsNegativePrompt: true,
      supportsWeightSyntax: true,
      supportsSeed: true,
      maxCount: 4,
      sizes: ['512x896']
    }
    expect(
      providerCapabilitiesSchema.parse({ schemaVersion: 'provider-capabilities/1', image: profile }).image
        ?.supportsWeightSyntax
    ).toBe(true)
    expect(
      providerCapabilitiesSchema.parse({
        schemaVersion: 'provider-capabilities/1',
        image: { ...profile, sizes: ['2K', '1.5K', '4096x4096'] }
      }).image?.sizes
    ).toEqual(['2K', '1.5K', '4096x4096'])
    const { supportsWeightSyntax: _ignored, ...without } = profile
    expect(() =>
      providerCapabilitiesSchema.parse({ schemaVersion: 'provider-capabilities/1', image: without })
    ).toThrow()
  })
})

describe('promptReverseOutputSchema', () => {
  const block = {
    id: 'subject.identity',
    category: 'subject',
    label: '人物身份',
    text: '银白长发与蓝色眼睛',
    weight: 1.2,
    locked: false,
    confidence: 0.8,
    evidence: [],
    source: 'vision-model',
    priority: 100,
    requirementRefs: ['req_identity'],
    materialRefs: []
  }

  it('accepts vision-model output with positive and negative blocks', () => {
    expect(
      promptReverseOutputSchema.parse({
        blocks: [block],
        negativeBlocks: [
          {
            ...block,
            id: 'negative.avoid',
            category: 'negative',
            text: '避免写实皮肤',
            source: 'vision-model',
            requirementRefs: []
          }
        ]
      }).blocks
    ).toHaveLength(1)
  })

  it('rejects locked, user-sourced, and mis-categorized blocks', () => {
    expect(() => promptReverseOutputSchema.parse({ blocks: [{ ...block, locked: true }] })).toThrow()
    expect(() => promptReverseOutputSchema.parse({ blocks: [{ ...block, source: 'user' }] })).toThrow()
    expect(() => promptReverseOutputSchema.parse({ blocks: [{ ...block, category: 'negative' }] })).toThrow()
    expect(() =>
      promptReverseOutputSchema.parse({
        blocks: [block],
        negativeBlocks: [{ ...block, id: 'negative.avoid', category: 'style' }]
      })
    ).toThrow()
  })
})
