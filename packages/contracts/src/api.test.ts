import { describe, expect, it } from 'vitest'
import {
  acceptSuggestionInputSchema,
  applyPromptReverseInputSchema,
  commitPromptDraftInputSchema,
  createForkInputSchema,
  createGenerationInputSchema,
  createManualArtVersionInputSchema,
  createProviderConnectionInputSchema,
  promptInputMetadataSchema,
  promptInputMultipartMetadataSchema,
  promptReverseInputSchema,
  promptSuggestionInputSchema,
  providerProbeDtoSchema,
  providerProbeInputSchema,
  updateProviderConnectionInputSchema
} from './api'
import { promptSyncInputSchema } from './prompt-sync'
import { getErrorDefinition } from './errors'

const CHAT_MODEL = {
  id: 'chat-1',
  name: null,
  kind: 'chat' as const,
  adapter: 'openai-compatible' as const,
  capabilities: {
    schemaVersion: 'provider-capabilities/1' as const,
    chat: { maxImages: 0, maxPromptChars: 20_000, supportsVision: false }
  }
}
const IMAGE_MODEL = {
  id: 'image-1',
  name: 'Seedream',
  kind: 'image' as const,
  adapter: 'seedream' as const,
  capabilities: {
    schemaVersion: 'provider-capabilities/1' as const,
    image: {
      maxReferenceImages: 4,
      maxPromptChars: 20_000,
      supportsNegativePrompt: false,
      supportsWeightSyntax: false,
      supportsSeed: true,
      maxCount: 4,
      sizes: ['1024x1024']
    }
  }
}

describe('API schemas', () => {
  it('applies generation defaults and accepts an optional base artwork without changing references', () => {
    const parsed = createGenerationInputSchema.parse({
      promptVersionId: 'pv_1',
      providerConnectionId: 'conn_1'
    })
    expect(parsed.count).toBe(1)
    expect(parsed.baseArtVersionId).toBeUndefined()
    expect(
      createGenerationInputSchema.parse({
        promptVersionId: 'pv_1',
        providerConnectionId: 'conn_1',
        baseArtVersionId: 'av_1'
      }).baseArtVersionId
    ).toBe('av_1')
    expect(() =>
      createGenerationInputSchema.parse({
        promptVersionId: 'pv_1',
        providerConnectionId: 'conn_1',
        count: 9
      })
    ).toThrow()
  })

  it('accepts up to eight generation images', () => {
    const parsed = createGenerationInputSchema.parse({
      promptVersionId: 'pv_1',
      providerConnectionId: 'conn_1',
      count: 8
    })
    expect(parsed.count).toBe(8)
  })

  it('defaults the current-artwork reference option to off', () => {
    expect(
      createGenerationInputSchema.parse({
        promptVersionId: 'pv_1',
        providerConnectionId: 'conn_1'
      }).includeBaseArtworkReference
    ).toBe(false)
    expect(
      createGenerationInputSchema.parse({
        promptVersionId: 'pv_1',
        providerConnectionId: 'conn_1',
        includeBaseArtworkReference: true
      }).includeBaseArtworkReference
    ).toBe(true)
  })

  it('accepts named image resolution presets', () => {
    expect(
      createGenerationInputSchema.parse({
        promptVersionId: 'pv_1',
        providerConnectionId: 'conn_1',
        size: '1.5K'
      }).size
    ).toBe('1.5K')
    expect(
      createGenerationInputSchema.parse({
        promptVersionId: 'pv_1',
        providerConnectionId: 'conn_1',
        size: '4096x4096'
      }).size
    ).toBe('4096x4096')
  })

  it('accepts only an artwork asset when creating a manual art version', () => {
    expect(
      createManualArtVersionInputSchema.parse({
        assetId: 'ast_01J00000000000000000000000',
        promptVersionId: 'pv_1'
      })
    ).toEqual({
      assetId: 'ast_01J00000000000000000000000',
      promptVersionId: 'pv_1'
    })
    expect(() =>
      createManualArtVersionInputSchema.parse({
        assetId: 'ast_01J00000000000000000000000',
        role: 'identity_reference'
      })
    ).toThrow()
  })

  it('rejects provider secrets in extra fields', () => {
    expect(() =>
      createProviderConnectionInputSchema.parse({
        label: 'x',
        kind: 'image',
        adapter: 'seedream',
        apiKey: 'sk-should-not-be-here',
        capabilities: {
          schemaVersion: 'provider-capabilities/1',
          image: {
            maxReferenceImages: 1,
            maxPromptChars: 1000,
            supportsNegativePrompt: false,
            supportsWeightSyntax: false,
            supportsSeed: false,
            maxCount: 1,
            sizes: ['1024x1024']
          }
        }
      })
    ).toThrow()
  })

  it('allows HTTPS or loopback HTTP provider URLs and rejects metadata/private hosts', () => {
    const base = {
      label: 'x',
      kind: 'chat' as const,
      adapter: 'openai-compatible' as const,
      capabilities: {
        schemaVersion: 'provider-capabilities/1' as const,
        chat: {
          maxImages: 4,
          maxPromptChars: 4000,
          supportsVision: true
        }
      }
    }
    expect(
      createProviderConnectionInputSchema.parse({ ...base, baseUrl: 'https://api.example.com/v1' }).baseUrl
    ).toBe('https://api.example.com/v1')
    expect(
      createProviderConnectionInputSchema.parse({ ...base, baseUrl: 'http://127.0.0.1:11434/v1' }).baseUrl
    ).toBe('http://127.0.0.1:11434/v1')
    expect(() =>
      createProviderConnectionInputSchema.parse({
        ...base,
        baseUrl: 'http://169.254.169.254/latest/meta-data'
      })
    ).toThrow(/HTTPS|loopback/)
    expect(() =>
      createProviderConnectionInputSchema.parse({
        ...base,
        baseUrl: 'https://10.0.0.5/v1'
      })
    ).toThrow(/HTTPS|loopback/)
  })

  it('requires supportsWeightSyntax on every image capability profile', () => {
    const image = {
      maxReferenceImages: 4,
      maxPromptChars: 4000,
      supportsNegativePrompt: true,
      supportsSeed: true,
      maxCount: 4,
      sizes: ['512x896']
    }
    expect(() =>
      createProviderConnectionInputSchema.parse({
        label: 'x',
        kind: 'image',
        adapter: 'mock',
        capabilities: { schemaVersion: 'provider-capabilities/1', image }
      })
    ).toThrow()
    expect(
      createProviderConnectionInputSchema.parse({
        label: 'x',
        kind: 'image',
        adapter: 'mock',
        capabilities: {
          schemaVersion: 'provider-capabilities/1',
          image: { ...image, supportsWeightSyntax: true }
        }
      }).kind
    ).toBe('image')
  })

  it('requires stable fork labels and material roles', () => {
    expect(createForkInputSchema.parse({ title: 'child', branchLabel: '冬季服' }).title).toBe('child')
    expect(() =>
      promptInputMetadataSchema.parse({
        requirements: [],
        materials: [
          {
            partName: 'face',
            assetId: 'ast_01J00000000000000000000000',
            role: 'not-a-role',
            sortOrder: 0
          }
        ]
      })
    ).toThrow()
  })

  it('requires a brief or at least one reference and rejects both brief sources', () => {
    expect(() => promptInputMetadataSchema.parse({ requirements: [], materials: [] })).toThrow(
      /brief|reference/i
    )
    expect(
      promptInputMetadataSchema.parse({
        characterBrief: { schemaVersion: 'character-brief/1', identity: { fullName: '霜' } },
        requirements: [],
        materials: []
      }).characterBrief?.identity.fullName
    ).toBe('霜')
    expect(() =>
      promptInputMetadataSchema.parse({
        characterBrief: { schemaVersion: 'character-brief/1', identity: { fullName: '霜' } },
        characterBriefVersionId: 'cbv_01J00000000000000000000000',
        requirements: [],
        materials: []
      })
    ).toThrow(/either/i)
  })

  it('accepts a reference-only initial input', () => {
    const parsed = promptInputMetadataSchema.parse({
      requirements: [],
      materials: [
        {
          partName: 'face',
          assetId: 'ast_01J00000000000000000000000',
          role: 'identity_reference',
          sortOrder: 0
        }
      ]
    })
    expect(parsed.characterBriefVersionId).toBeUndefined()
    expect(parsed.materials).toHaveLength(1)
  })

  it('requires exactly one source for an uploaded prompt material', () => {
    const base = { partName: 'face', role: 'identity_reference', sortOrder: 0 }
    expect(() => promptInputMultipartMetadataSchema.parse({ materials: [base] })).toThrow(
      /assetId|fileField/i
    )
    expect(() =>
      promptInputMultipartMetadataSchema.parse({
        materials: [
          {
            ...base,
            assetId: 'ast_01J00000000000000000000000',
            fileField: 'file_face'
          }
        ]
      })
    ).toThrow(/exactly one/i)
    expect(
      promptInputMultipartMetadataSchema.parse({
        materials: [{ ...base, fileField: 'file_face' }]
      }).materials[0]!.fileField
    ).toBe('file_face')
  })

  it('accepts an empty prompt draft commit body and applies the acknowledgement default', () => {
    expect(commitPromptDraftInputSchema.parse({}).acknowledgeUncoveredRequirements).toBe(false)
    expect(
      commitPromptDraftInputSchema.parse({ acknowledgeUncoveredRequirements: true })
        .acknowledgeUncoveredRequirements
    ).toBe(true)
    expect(() => commitPromptDraftInputSchema.parse({ acknowledge: true })).toThrow()
  })

  it('rejects duplicate part names and file fields', () => {
    const material = {
      partName: 'face',
      role: 'identity_reference',
      sortOrder: 0,
      fileField: 'file_face'
    }
    expect(() =>
      promptInputMultipartMetadataSchema.parse({
        materials: [material, { ...material }]
      })
    ).toThrow()
    expect(() =>
      promptInputMultipartMetadataSchema.parse({
        materials: [material, { ...material, partName: 'body' }]
      })
    ).toThrow()
  })

  it('defaults provider probes to non-billable and rejects unknown input fields', () => {
    expect(providerProbeInputSchema.parse({})).toEqual({ allowBillableRequest: false })
    expect(providerProbeInputSchema.parse({ allowBillableRequest: true })).toEqual({
      allowBillableRequest: true
    })
    expect(() => providerProbeInputSchema.parse({ allowBillableRequest: 'yes' })).toThrow()
    expect(() => providerProbeInputSchema.parse({ allowBillableRequest: true, apiKey: 'secret' })).toThrow()
  })

  it('returns a strict provider probe DTO without credentials or upstream body', () => {
    const probe = {
      ok: true,
      kind: 'chat',
      adapter: 'openai-compatible',
      model: 'gpt-test',
      latencyMs: 120,
      checkedAt: 1_763_000_000_000,
      billable: false
    }
    expect(providerProbeDtoSchema.parse(probe)).toEqual(probe)
    expect(JSON.stringify(providerProbeDtoSchema.parse(probe))).not.toMatch(/apiKey|secretRef|responseText/)
    expect(() =>
      providerProbeDtoSchema.parse({
        ...probe,
        apiKey: 'sk-should-not-be-here'
      })
    ).toThrow()
    expect(() =>
      providerProbeDtoSchema.parse({
        ...probe,
        kind: 'image',
        adapter: 'openai-compatible'
      })
    ).toThrow(/adapter/)
  })

  it('accepts optional operation indexes for partial suggestion acceptance', () => {
    expect(acceptSuggestionInputSchema.parse({ expectedDraftRowVersion: 3 })).toEqual({
      expectedDraftRowVersion: 3
    })
    expect(
      acceptSuggestionInputSchema.parse({ expectedDraftRowVersion: 3, operationIndexes: [0, 2] })
    ).toEqual({ expectedDraftRowVersion: 3, operationIndexes: [0, 2] })
    expect(() =>
      acceptSuggestionInputSchema.parse({ expectedDraftRowVersion: 3, operationIndexes: [] })
    ).toThrow()
    expect(() =>
      acceptSuggestionInputSchema.parse({ expectedDraftRowVersion: 3, operationIndexes: [1, 1] })
    ).toThrow(/unique/i)
  })
})

it('accepts a fixed preset with a model catalog', () => {
  const parsed = createProviderConnectionInputSchema.parse({
    label: '火山方舟',
    kind: 'chat',
    adapter: 'openai-compatible',
    model: 'chat-1',
    capabilities: CHAT_MODEL.capabilities,
    presetId: 'volcengine-ark',
    models: [CHAT_MODEL, IMAGE_MODEL]
  })
  expect(parsed).toMatchObject({ presetId: 'volcengine-ark', models: [CHAT_MODEL, IMAGE_MODEL] })
  expect(updateProviderConnectionInputSchema.parse({ models: [CHAT_MODEL] })).toMatchObject({
    models: [CHAT_MODEL]
  })
})

it('accepts an optional block subset when applying reverse results', () => {
  expect(applyPromptReverseInputSchema.parse({})).toEqual({})
  expect(applyPromptReverseInputSchema.parse({ blockIds: ['style.requested'] })).toEqual({
    blockIds: ['style.requested']
  })
  expect(applyPromptReverseInputSchema.safeParse({ blockIds: [] }).success).toBe(false)
})

it('adds modelId to generation and prompt task inputs', () => {
  expect(
    createGenerationInputSchema.parse({
      promptVersionId: 'v1',
      providerConnectionId: 'c1',
      modelId: 'image-1',
      count: 1
    })
  ).toMatchObject({ modelId: 'image-1' })
  expect(promptReverseInputSchema.parse({ providerConnectionId: 'c1', modelId: 'chat-1' })).toMatchObject({
    modelId: 'chat-1'
  })
  expect(
    promptSuggestionInputSchema.parse({
      providerConnectionId: 'c1',
      intent: '更冷一点',
      modelId: 'chat-1'
    })
  ).toMatchObject({ modelId: 'chat-1' })
  expect(
    promptSyncInputSchema.parse({
      providerConnectionId: 'c1',
      source: 'full',
      state: {
        schemaVersion: 'prompt-spec/2',
        fullPrompt: '',
        lockAll: false,
        sourceRequirements: [],
        materialRefs: [],
        blocks: [],
        negativeBlocks: [],
        constraints: {
          canvas: { width: 1024, height: 1024 },
          background: 'unspecified',
          aspect: 'square'
        }
      },
      modelId: 'chat-1'
    })
  ).toMatchObject({ modelId: 'chat-1' })
})

it('registers model discovery and task-selection errors', () => {
  expect(getErrorDefinition('PROVIDER_MODELS_UNSUPPORTED')).toMatchObject({
    code: 'PROVIDER_MODELS_UNSUPPORTED',
    httpStatus: 404
  })
  expect(getErrorDefinition('PROVIDER_MODEL_NOT_AVAILABLE')).toMatchObject({
    code: 'PROVIDER_MODEL_NOT_AVAILABLE',
    httpStatus: 422
  })
})
