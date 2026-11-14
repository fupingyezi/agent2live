import { describe, expect, it } from 'vitest'
import {
  createForkInputSchema,
  createGenerationInputSchema,
  createProviderConnectionInputSchema,
  promptInputMetadataSchema,
  promptInputMultipartMetadataSchema
} from './api'

describe('API schemas', () => {
  it('applies generation defaults and rejects count > 4', () => {
    const parsed = createGenerationInputSchema.parse({
      promptVersionId: 'pv_1',
      providerConnectionId: 'conn_1'
    })
    expect(parsed.count).toBe(1)
    expect(() =>
      createGenerationInputSchema.parse({
        promptVersionId: 'pv_1',
        providerConnectionId: 'conn_1',
        count: 5
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
})
