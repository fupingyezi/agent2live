import { describe, expect, it } from 'vitest'
import { hashCanonical } from '@agent2live/contracts'
import { buildGenerationRequest, foldedReferenceInstruction, planReferences } from '../src/generation/request'
import type { ManagedReferenceInput, PromptMaterialReferenceInput } from '../src/generation/request'

const assetId = (digit: number) => `ast_${'0'.repeat(25)}${digit.toString(36).toUpperCase()}`
const activeRef = (
  digit: number,
  sortOrder: number,
  isPrimary = false,
  note = `note-${sortOrder}`
): ManagedReferenceInput => ({
  assetId: assetId(digit),
  role: 'identity_reference',
  note,
  weight: 1,
  sortOrder,
  isPrimary
})
const materialRef = (digit: number, note = `material-${digit}`): PromptMaterialReferenceInput => ({
  assetId: assetId(digit),
  role: 'style_reference',
  note,
  weight: 0.8
})

describe('generation references', () => {
  it('freezes the full ordered active reference set and appends deduped materials', () => {
    const plan = planReferences({
      activeReferences: [activeRef(0, 0, true), activeRef(1, 1), activeRef(2, 2)],
      promptMaterials: [materialRef(2), materialRef(3)],
      limit: 8
    })
    expect(plan.mode).toBe('full')
    expect(plan.primaryAssetId).toBe(assetId(0))
    expect(plan.sentAssetIds).toEqual([assetId(0), assetId(1), assetId(2), assetId(3)])
    expect(plan.requested.map((reference) => reference.source)).toEqual([
      'art_version',
      'art_version',
      'art_version',
      'prompt_material'
    ])
    expect(plan.requested.map((reference) => reference.sortOrder)).toEqual([0, 1, 2, 3])
    expect(plan.warnings).toEqual([])
    expect(plan.duplicateMaterialAssetIds).toEqual([assetId(2)])
    expect(plan.fingerprint).toBe(
      hashCanonical({
        schemaVersion: 'generation-references/1',
        requested: plan.requested
      })
    )
  })

  it('keeps the primary and trims auxiliary references by sort order', () => {
    const plan = planReferences({
      activeReferences: [activeRef(0, 0, true), activeRef(1, 1), activeRef(2, 2)],
      promptMaterials: [],
      limit: 2
    })
    expect(plan).toMatchObject({
      mode: 'truncated',
      primaryAssetId: assetId(0),
      sentAssetIds: [assetId(0), assetId(1)],
      droppedAssetIds: [assetId(2)],
      foldedAssetIds: [],
      warnings: ['reference_budget_exceeded']
    })
    expect(plan.requested).toHaveLength(3)
  })

  it('folds every auxiliary reference into explicit text for a single-image provider', () => {
    const plan = planReferences({
      activeReferences: [activeRef(0, 0, true), activeRef(1, 1)],
      promptMaterials: [materialRef(3, '银灰色短发')],
      limit: 1
    })
    expect(plan).toMatchObject({
      mode: 'folded_single_image',
      sentAssetIds: [assetId(0)],
      foldedAssetIds: [assetId(1), assetId(3)],
      droppedAssetIds: [],
      warnings: ['auxiliary_images_folded']
    })
    const text = foldedReferenceInstruction(
      plan.requested.filter((reference) => plan.foldedAssetIds.includes(reference.assetId))
    )
    expect(text).toContain('were not sent to the image model')
    expect(text).toContain('identity_reference')
    expect(text).toContain('银灰色短发')
    expect(text).not.toContain('silver hair')
  })

  it('uses prompt materials when there is no active art version', () => {
    const plan = planReferences({
      activeReferences: [],
      promptMaterials: [materialRef(3), materialRef(4)],
      limit: 4
    })
    expect(plan.mode).toBe('full')
    expect(plan.primaryAssetId).toBeNull()
    expect(plan.sentAssetIds).toEqual([assetId(3), assetId(4)])
    expect(plan.requested.every((reference) => reference.source === 'prompt_material')).toBe(true)
  })

  it('allows text-only generation when there are no references', () => {
    const plan = planReferences({ activeReferences: [], promptMaterials: [], limit: 0 })
    expect(plan).toMatchObject({
      mode: 'none',
      primaryAssetId: null,
      sentAssetIds: [],
      foldedAssetIds: [],
      droppedAssetIds: [],
      warnings: []
    })
  })

  it('keeps the full snapshot and reports text-only degradation when images are unsupported', () => {
    const plan = planReferences({
      activeReferences: [activeRef(0, 0, true), activeRef(1, 1)],
      promptMaterials: [],
      limit: 0
    })
    expect(plan).toMatchObject({
      mode: 'ignored_no_image_input',
      primaryAssetId: assetId(0),
      sentAssetIds: [],
      foldedAssetIds: [],
      droppedAssetIds: [assetId(0), assetId(1)],
      warnings: ['references_ignored_no_image_input']
    })
    expect(plan.requested).toHaveLength(2)
  })

  it('rejects an active set without exactly one primary at sort order zero', () => {
    expect(() =>
      planReferences({
        activeReferences: [activeRef(0, 0), activeRef(1, 1)],
        promptMaterials: [],
        limit: 4
      })
    ).toThrow(expect.objectContaining({ code: 'SYS_INTERNAL' }))
    expect(() =>
      planReferences({
        activeReferences: [activeRef(0, 1, true), activeRef(1, 0)],
        promptMaterials: [],
        limit: 4
      })
    ).toThrow(expect.objectContaining({ code: 'SYS_INTERNAL' }))
  })

  it('changes the fingerprint when any reference metadata changes', () => {
    const base = planReferences({
      activeReferences: [activeRef(0, 0, true), activeRef(1, 1)],
      promptMaterials: [],
      limit: 4
    })
    const changed = planReferences({
      activeReferences: [activeRef(0, 0, true), activeRef(1, 1, false, 'different note')],
      promptMaterials: [],
      limit: 4
    })
    expect(changed.fingerprint).not.toBe(base.fingerprint)
  })

  it('freezes the plan in the generation request hash', () => {
    const plan = planReferences({
      activeReferences: [activeRef(0, 0, true), activeRef(1, 1)],
      promptMaterials: [],
      limit: 1
    })
    const prepared = {
      artProjectId: 'proj_1',
      promptVersionId: 'pv_1',
      baseArtVersionId: 'av_1',
      providerConnectionId: 'pc_1',
      promptContentHash: hashCanonical({ prompt: 'x' }),
      compiled: {
        prompt: 'x',
        negativePrompt: '',
        truncated: false,
        droppedBlockIds: [],
        warnings: ['auxiliary_images_folded'],
        promptLength: 1
      },
      referenceAssetIds: plan.sentAssetIds,
      primaryReferenceAssetId: plan.primaryAssetId,
      references: plan,
      count: 1,
      size: '512x896',
      seed: null
    }
    const generationJobId = `gen_${'A'.repeat(26)}`
    const request = buildGenerationRequest(prepared, generationJobId)
    expect(request.references).toEqual(plan)
    expect(request.requestHash).toBe(
      hashCanonical({
        schemaVersion: 'generation-request/1',
        generationJobId,
        ...prepared
      })
    )
  })
})
