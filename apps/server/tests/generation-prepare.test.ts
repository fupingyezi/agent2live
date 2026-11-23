import { describe, expect, it } from 'vitest'
import { hashCanonical, type PromptReference } from '@agent2live/contracts'
import { buildGenerationRequest, planReferences } from '../src/generation/request'

const assetId = (digit: number) => `ast_${'0'.repeat(25)}${digit.toString(36).toUpperCase()}`
const reference = (digit: number, note = `note-${digit}`): PromptReference => ({
  assetId: assetId(digit),
  role: 'identity_reference',
  note,
  weight: 1,
  locked: false
})

describe('generation references', () => {
  it('freezes the full ordered PromptVersion reference set', () => {
    const plan = planReferences({
      references: [reference(0), reference(1), reference(2)],
      limit: 8
    })
    expect(plan.mode).toBe('full')
    expect(plan.sentAssetIds).toEqual([assetId(0), assetId(1), assetId(2)])
    expect(plan.requested.map((item) => item.source)).toEqual([
      'prompt_version',
      'prompt_version',
      'prompt_version'
    ])
    expect(plan.requested.map((item) => item.sortOrder)).toEqual([0, 1, 2])
    expect(plan.warnings).toEqual([])
    expect(plan.fingerprint).toBe(
      hashCanonical({
        schemaVersion: 'generation-references/2',
        requested: plan.requested
      })
    )
  })

  it('trims references by order when the provider budget is smaller', () => {
    const plan = planReferences({
      references: [reference(0), reference(1), reference(2)],
      limit: 2
    })
    expect(plan).toMatchObject({
      mode: 'truncated',
      sentAssetIds: [assetId(0), assetId(1)],
      droppedAssetIds: [assetId(2)],
      warnings: ['reference_budget_exceeded']
    })
    expect(plan.requested).toHaveLength(3)
  })

  it('sends only the first reference for a single-image provider', () => {
    const plan = planReferences({
      references: [reference(0), reference(1), reference(2)],
      limit: 1
    })
    expect(plan).toMatchObject({
      mode: 'truncated',
      sentAssetIds: [assetId(0)],
      droppedAssetIds: [assetId(1), assetId(2)],
      warnings: ['reference_budget_exceeded']
    })
  })

  it('allows text-only generation when there are no references', () => {
    const plan = planReferences({ references: [], limit: 0 })
    expect(plan).toMatchObject({
      mode: 'none',
      sentAssetIds: [],
      droppedAssetIds: [],
      warnings: []
    })
  })

  it('keeps the full snapshot and reports text-only degradation when images are unsupported', () => {
    const plan = planReferences({
      references: [reference(0), reference(1)],
      limit: 0
    })
    expect(plan).toMatchObject({
      mode: 'ignored_no_image_input',
      sentAssetIds: [],
      droppedAssetIds: [assetId(0), assetId(1)],
      warnings: ['references_ignored_no_image_input']
    })
    expect(plan.requested).toHaveLength(2)
  })

  it('rejects duplicate reference assets', () => {
    expect(() =>
      planReferences({
        references: [reference(0), reference(0)],
        limit: 4
      })
    ).toThrow(expect.objectContaining({ code: 'SYS_INTERNAL' }))
  })

  it('changes the fingerprint when any reference metadata or order changes', () => {
    const base = planReferences({
      references: [reference(0), reference(1)],
      limit: 4
    })
    const changed = planReferences({
      references: [reference(1), reference(0)],
      limit: 4
    })
    expect(changed.fingerprint).not.toBe(base.fingerprint)
  })

  it('freezes the plan in the generation request hash', () => {
    const plan = planReferences({
      references: [reference(0), reference(1)],
      limit: 1
    })
    const prepared = {
      artProjectId: 'proj_1',
      promptVersionId: 'pv_1',
      baseArtVersionId: 'av_1',
      providerConnectionId: 'pc_1',
      model: {
        providerConnectionId: 'pc_1',
        modelId: 'mock-image-a',
        adapter: 'mock' as const,
        capabilities: {
          schemaVersion: 'provider-capabilities/1' as const,
          image: {
            maxReferenceImages: 8,
            maxPromptChars: 20_000,
            supportsNegativePrompt: true,
            supportsWeightSyntax: true,
            supportsSeed: true,
            maxCount: 4,
            sizes: ['512x896']
          }
        }
      },
      promptContentHash: hashCanonical({ prompt: 'x' }),
      compiled: {
        prompt: 'x',
        negativePrompt: '',
        truncated: false,
        droppedBlockIds: [],
        warnings: ['reference_budget_exceeded'],
        promptLength: 1
      },
      referenceAssetIds: plan.sentAssetIds,
      references: plan,
      count: 1,
      size: '512x896',
      seed: null
    }
    const generationId = `gen_${'A'.repeat(26)}`
    const request = buildGenerationRequest(prepared, generationId)
    expect(request.references).toEqual(plan)
    expect(request.requestHash).toBe(
      hashCanonical({
        schemaVersion: 'generation-request/1',
        generationJobId: generationId,
        ...prepared
      })
    )
  })
})
