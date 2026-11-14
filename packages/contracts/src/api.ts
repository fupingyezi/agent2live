import { z } from 'zod'
import type { RefinementCtx } from 'zod'
import { materialRoleSchema, promptRequirementSchema, providerCapabilitiesSchema } from './prompt'
import { characterBriefContentSchema } from './character-brief'

const title = z.string().trim().min(1).max(100)
const description = z.string().max(4000)
const assetId = z.string().regex(/^ast_[0-9A-HJKMNP-TV-Z]{26}$/)
const characterBriefVersionId = z.string().regex(/^cbv_[0-9A-HJKMNP-TV-Z]{26}$/)

function isBlockedProviderHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (host === '169.254.169.254' || host.endsWith('.local') || host === 'metadata.google.internal') {
    return true
  }
  if (/^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) {
    return true
  }
  if (/^(fc|fd|fe80):/i.test(host)) return true
  return false
}

const providerBaseUrlSchema = z
  .string()
  .url()
  .max(500)
  .refine(
    (value) => {
      let url: URL
      try {
        url = new URL(value)
      } catch {
        return false
      }
      if (url.username || url.password) return false
      if (isBlockedProviderHost(url.hostname)) return false
      return (
        url.protocol === 'https:' ||
        (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
      )
    },
    { message: 'provider URL must use HTTPS or loopback HTTP' }
  )

export const createCharacterInputSchema = z
  .object({
    title,
    summary: z.string().max(2000).optional()
  })
  .strict()

export const updateCharacterInputSchema = z
  .object({
    title: title.optional(),
    summary: z.string().max(2000).nullable().optional()
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: 'patch is empty' })

export const createArtProjectInputSchema = z
  .object({
    title,
    description: description.optional()
  })
  .strict()

export const updateArtProjectInputSchema = z
  .object({
    title: title.optional(),
    description: description.nullable().optional()
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: 'patch is empty' })

const materialFields = {
  role: materialRoleSchema,
  note: z.string().max(1000).default(''),
  weight: z.number().min(0.1).max(2).default(1),
  locked: z.boolean().default(false),
  sortOrder: z.number().int().nonnegative().max(500)
}

const partName = z.string().trim().min(1).max(80)
const fileField = z.string().regex(/^file_[A-Za-z0-9_-]{1,60}$/)

export const promptInputMaterialRefSchema = z
  .object({
    ...materialFields,
    partName,
    assetId
  })
  .strict()

export const promptInputMaterialUploadSchema = z
  .object({
    ...materialFields,
    partName,
    assetId: assetId.optional(),
    fileField: fileField.optional()
  })
  .strict()
  .refine((value) => Boolean(value.assetId) !== Boolean(value.fileField), {
    message: 'material needs exactly one of assetId or fileField',
    path: ['assetId']
  })

const promptInputBaseShape = {
  characterBrief: characterBriefContentSchema.optional(),
  characterBriefVersionId: characterBriefVersionId.optional(),
  globalNotes: z.string().max(8000).optional(),
  requirements: z.array(promptRequirementSchema).max(200).default([])
}

interface InitialInputMaterialFields {
  partName?: string | undefined
  fileField?: string | undefined
}

interface InitialInputValue {
  characterBrief?: unknown
  characterBriefVersionId?: string | undefined
  requirements?: ReadonlyArray<{ id?: unknown }> | undefined
  materials: ReadonlyArray<InitialInputMaterialFields>
}

function validateInitialInput(value: InitialInputValue, ctx: RefinementCtx): void {
  if (value.characterBrief && value.characterBriefVersionId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'provide either characterBrief or characterBriefVersionId, not both',
      path: ['characterBriefVersionId']
    })
  }
  if (!value.characterBrief && !value.characterBriefVersionId && value.materials.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'a character brief or at least one reference is required',
      path: ['materials']
    })
  }
  const requirementIds = new Set<string>()
  for (const requirement of value.requirements ?? []) {
    if (typeof requirement.id !== 'string') continue
    if (requirementIds.has(requirement.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'duplicate requirement id',
        path: ['requirements']
      })
    }
    requirementIds.add(requirement.id)
  }
  const partNames = new Set<string>()
  const fileFields = new Set<string>()
  value.materials.forEach((material, index) => {
    if (typeof material.partName === 'string') {
      if (partNames.has(material.partName)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'duplicate partName',
          path: ['materials', index, 'partName']
        })
      }
      partNames.add(material.partName)
    }
    if (typeof material.fileField === 'string') {
      if (fileFields.has(material.fileField)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'duplicate fileField',
          path: ['materials', index, 'fileField']
        })
      }
      fileFields.add(material.fileField)
    }
  })
}

export const promptInputMultipartMetadataSchema = z
  .object({
    ...promptInputBaseShape,
    materials: z.array(promptInputMaterialUploadSchema).max(14).default([])
  })
  .strict()
  .superRefine(validateInitialInput)

export const promptInputMetadataSchema = z
  .object({
    ...promptInputBaseShape,
    materials: z.array(promptInputMaterialRefSchema).max(14).default([])
  })
  .strict()
  .superRefine(validateInitialInput)

export const createProviderConnectionInputSchema = z
  .object({
    label: z.string().trim().min(1).max(80),
    kind: z.enum(['chat', 'image']),
    adapter: z.enum(['openai-compatible', 'seedream', 'mock']),
    baseUrl: providerBaseUrlSchema.optional(),
    model: z.string().min(1).max(200).optional(),
    secretRef: z
      .string()
      .regex(/^sec_[0-9A-HJKMNP-TV-Z]{26}$/)
      .optional(),
    enabled: z.boolean().default(true),
    capabilities: providerCapabilitiesSchema
  })
  .strict()

export const updateProviderConnectionInputSchema = z
  .object({
    label: z.string().trim().min(1).max(80).optional(),
    baseUrl: providerBaseUrlSchema.nullable().optional(),
    model: z.string().min(1).max(200).nullable().optional(),
    secretRef: z
      .string()
      .regex(/^sec_[0-9A-HJKMNP-TV-Z]{26}$/)
      .nullable()
      .optional(),
    enabled: z.boolean().optional(),
    capabilities: providerCapabilitiesSchema.optional()
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: 'patch is empty' })

export const createGenerationInputSchema = z
  .object({
    promptVersionId: z.string().min(1).max(64),
    providerConnectionId: z.string().min(1).max(64),
    count: z.number().int().min(1).max(4).default(1),
    size: z
      .string()
      .regex(/^\d{3,4}x\d{3,4}$/)
      .optional(),
    seed: z.number().int().min(0).max(2_147_483_647).nullable().optional()
  })
  .strict()

export const promptReverseInputSchema = z
  .object({
    providerConnectionId: z.string().min(1).max(64),
    inputSubmissionId: z.string().min(1).max(64).optional()
  })
  .strict()

export const promptSuggestionInputSchema = z
  .object({
    providerConnectionId: z.string().min(1).max(64),
    intent: z.string().trim().min(1).max(2000)
  })
  .strict()

export const applyPromptReverseInputSchema = z.object({}).strict()

export const promptReverseResultStatusSchema = z.enum(['ready', 'applied', 'discarded'])
export const listPromptReverseResultsQuerySchema = z
  .object({
    status: promptReverseResultStatusSchema.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50)
  })
  .strict()

export const acceptSuggestionInputSchema = z
  .object({
    expectedDraftRowVersion: z.number().int().positive().nullable()
  })
  .strict()

export const createManualArtVersionInputSchema = z
  .object({
    assetId,
    promptVersionId: z.string().min(1).max(64).optional(),
    role: materialRoleSchema.default('identity_reference'),
    note: z.string().max(1000).default(''),
    weight: z.number().min(0.1).max(2).default(1)
  })
  .strict()

export const activateArtVersionInputSchema = z
  .object({
    reason: z.enum(['switch', 'rollback'])
  })
  .strict()

export const artVersionListQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(50)
  })
  .strict()

export const acceptGenerationCandidateInputSchema = z
  .object({
    expectedActiveArtVersionId: z.string().min(1).max(64).nullable()
  })
  .strict()

export const createForkInputSchema = z
  .object({
    title,
    branchLabel: z.string().trim().min(1).max(80),
    description: description.optional()
  })
  .strict()

export const patchForkInputSchema = z
  .object({
    branchLabel: z.string().trim().min(1).max(80).optional(),
    detach: z.literal(true).optional()
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: 'patch is empty' })

export const characterLineageQuerySchema = z
  .object({
    characterId: z.string().min(1).max(64)
  })
  .strict()

export const createBackupInputSchema = z.object({}).strict()

export const createDraftInputSchema = z
  .object({
    from: z.enum(['active_version', 'empty']).default('active_version')
  })
  .strict()

export const commitPromptDraftInputSchema = z
  .object({
    acknowledgeUncoveredRequirements: z.boolean().default(false)
  })
  .strict()

export const emptyBodySchema = z.object({}).strict()

export type CreateCharacterInput = z.infer<typeof createCharacterInputSchema>
export type CreateArtProjectInput = z.infer<typeof createArtProjectInputSchema>
export type PromptInputMetadata = z.infer<typeof promptInputMetadataSchema>
export type PromptInputMultipartMetadata = z.infer<typeof promptInputMultipartMetadataSchema>
export type CreateProviderConnectionInput = z.infer<typeof createProviderConnectionInputSchema>
export type UpdateProviderConnectionInput = z.infer<typeof updateProviderConnectionInputSchema>
export type CreateGenerationInput = z.infer<typeof createGenerationInputSchema>
export type CreateForkInput = z.infer<typeof createForkInputSchema>
export type PatchForkInput = z.infer<typeof patchForkInputSchema>
