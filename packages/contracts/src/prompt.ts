import { z } from 'zod'
import type { RefinementCtx } from 'zod'

export const PROMPT_CATEGORIES = [
  'subject',
  'face',
  'hair',
  'outfit',
  'pose',
  'composition',
  'style',
  'lighting',
  'background',
  'safety',
  'negative',
  'other'
] as const

export const PROMPT_SOURCES = [
  'user',
  'vision-model',
  'template',
  'ai-suggestion',
  'import',
  'character-brief'
] as const

export const MATERIAL_ROLES = [
  'identity_reference',
  'style_reference',
  'outfit_reference',
  'color_reference',
  'background_reference',
  'pose_reference',
  'sketch',
  'texture',
  'other'
] as const

export const REQUIREMENT_STRENGTHS = ['must', 'prefer', 'avoid'] as const

export const promptCategorySchema = z.enum(PROMPT_CATEGORIES)
export const promptSourceSchema = z.enum(PROMPT_SOURCES)
export const materialRoleSchema = z.enum(MATERIAL_ROLES)
export const requirementStrengthSchema = z.enum(REQUIREMENT_STRENGTHS)

const idSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/)
const assetIdSchema = z.string().regex(/^ast_[0-9A-HJKMNP-TV-Z]{26}$/)
const hashSchema = z.string().regex(/^[0-9a-f]{64}$/)

export const promptRequirementSchema = z
  .object({
    id: z.string().min(1).max(80),
    text: z.string().trim().min(1).max(500),
    strength: requirementStrengthSchema
  })
  .strict()

export const promptMaterialRefSchema = z
  .object({
    assetId: assetIdSchema,
    role: materialRoleSchema,
    note: z.string().max(1000).default(''),
    weight: z.number().min(0.1).max(2).default(1),
    locked: z.boolean().default(false)
  })
  .strict()

export const promptEvidenceSchema = z
  .object({
    assetId: assetIdSchema,
    region: z
      .object({
        x: z.number().nonnegative(),
        y: z.number().nonnegative(),
        width: z.number().positive(),
        height: z.number().positive()
      })
      .strict()
      .optional()
  })
  .strict()

export const promptBlockSchema = z
  .object({
    id: idSchema,
    category: promptCategorySchema,
    label: z.string().trim().min(1).max(100),
    text: z.string().trim().min(1).max(4000),
    weight: z.number().min(0.1).max(2),
    locked: z.boolean(),
    confidence: z.number().min(0).max(1),
    evidence: z.array(promptEvidenceSchema).max(20),
    source: promptSourceSchema,
    priority: z.number().int().min(-1000).max(1000),
    requirementRefs: z.array(z.string().min(1).max(80)).max(50),
    materialRefs: z.array(assetIdSchema).max(20)
  })
  .strict()

export const promptConstraintsSchema = z
  .object({
    canvas: z
      .object({
        width: z.number().int().min(256).max(8192),
        height: z.number().int().min(256).max(8192)
      })
      .strict(),
    background: z.enum(['transparent', 'solid', 'scene', 'unspecified']),
    aspect: z.enum(['portrait', 'square', 'landscape'])
  })
  .strict()

const promptSpecShape = {
  schemaVersion: z.literal('prompt-spec/2'),
  lockAll: z.boolean(),
  sourceRequirements: z.array(promptRequirementSchema).max(200),
  materialRefs: z.array(promptMaterialRefSchema).max(14),
  blocks: z.array(promptBlockSchema).max(200),
  negativeBlocks: z.array(promptBlockSchema).max(50),
  constraints: promptConstraintsSchema
}

const promptSpecCoreObjectSchema = z.object(promptSpecShape).strict()

function refinePromptSpecCore(value: z.infer<typeof promptSpecCoreObjectSchema>, ctx: RefinementCtx): void {
  const ids = new Set<string>()
  for (const block of [...value.blocks, ...value.negativeBlocks]) {
    if (ids.has(block.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'duplicate block id',
        path: ['blocks']
      })
    }
    ids.add(block.id)
  }
  const requirements = new Map(value.sourceRequirements.map((requirement) => [requirement.id, requirement]))
  const assets = new Set(value.materialRefs.map((material) => material.assetId))
  for (const block of value.blocks) {
    for (const ref of block.requirementRefs) {
      const requirement = requirements.get(ref)
      if (!requirement) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'unknown requirement ref',
          path: ['blocks', block.id]
        })
      } else if (requirement.strength === 'avoid') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'avoid requirement must be on a negative block',
          path: ['blocks', block.id]
        })
      }
    }
    for (const assetId of block.materialRefs) {
      if (!assets.has(assetId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'unknown material ref',
          path: ['blocks', block.id]
        })
      }
    }
  }
  for (const block of value.negativeBlocks) {
    for (const ref of block.requirementRefs) {
      const requirement = requirements.get(ref)
      if (!requirement) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'unknown requirement ref',
          path: ['negativeBlocks', block.id]
        })
      } else if (requirement.strength !== 'avoid') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'negative block may only cite avoid requirements',
          path: ['negativeBlocks', block.id]
        })
      }
    }
    for (const assetId of block.materialRefs) {
      if (!assets.has(assetId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'unknown material ref',
          path: ['negativeBlocks', block.id]
        })
      }
    }
  }
}

export const promptSpecCoreSchema = promptSpecCoreObjectSchema.superRefine(refinePromptSpecCore)

export const promptSpecSchema = z
  .object({
    ...promptSpecShape,
    promptVersionId: z.string().max(64).optional(),
    artProjectId: z.string().max(64).optional(),
    characterId: z.string().max(64).optional(),
    parentVersionId: z.string().max(64).nullable().optional(),
    inputSubmissionId: z.string().max(64).optional(),
    characterBriefVersionId: z
      .string()
      .regex(/^cbv_[0-9A-HJKMNP-TV-Z]{26}$/)
      .nullable()
      .optional(),
    contentHash: hashSchema.optional()
  })
  .strict()
  .superRefine(refinePromptSpecCore)

export type PromptSpecV2 = z.infer<typeof promptSpecSchema>
export type PromptSpecCore = z.infer<typeof promptSpecCoreSchema>
export type PromptBlock = z.infer<typeof promptBlockSchema>
export type PromptRequirement = z.infer<typeof promptRequirementSchema>
export type PromptMaterialRef = z.infer<typeof promptMaterialRefSchema>

export const promptOperationSchema = z
  .discriminatedUnion('op', [
    z
      .object({
        op: z.literal('replace'),
        blockId: idSchema,
        before: z.string().max(4000),
        after: z.string().trim().min(1).max(4000),
        reason: z.string().max(500).optional()
      })
      .strict(),
    z
      .object({
        op: z.literal('setWeight'),
        blockId: idSchema,
        before: z.number().min(0.1).max(2),
        after: z.number().min(0.1).max(2),
        reason: z.string().max(500).optional()
      })
      .strict(),
    z
      .object({
        op: z.literal('add'),
        block: promptBlockSchema.refine((block) => !block.locked, {
          message: 'AI cannot add a locked block'
        })
      })
      .strict(),
    z
      .object({
        op: z.literal('remove'),
        blockId: idSchema,
        before: z.string().max(4000),
        reason: z.string().max(500).optional()
      })
      .strict()
  ])
  .superRefine((operation, ctx) => {
    const changed =
      (operation.op === 'replace' || operation.op === 'setWeight') && operation.before === operation.after
    if (changed) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'no-op operation is not allowed',
        path: []
      })
    }
  })

export const promptSuggestionOutputSchema = z
  .object({
    operations: z.array(promptOperationSchema).max(20),
    warnings: z.array(z.string().max(500)).max(20).default([])
  })
  .strict()

export type PromptSuggestionOutput = z.infer<typeof promptSuggestionOutputSchema>
export type PromptOperation = z.infer<typeof promptOperationSchema>

export const savePromptDraftInputSchema = z
  .object({
    state: promptSpecSchema
  })
  .strict()

export const providerCapabilitiesSchema = z
  .object({
    schemaVersion: z.literal('provider-capabilities/1'),
    chat: z
      .object({
        maxImages: z.number().int().min(0).max(32),
        maxPromptChars: z.number().int().min(1000).max(1_000_000),
        supportsVision: z.boolean()
      })
      .strict()
      .optional(),
    image: z
      .object({
        maxReferenceImages: z.number().int().min(0).max(32),
        maxPromptChars: z.number().int().min(1000).max(1_000_000),
        supportsNegativePrompt: z.boolean(),
        supportsWeightSyntax: z.boolean(),
        supportsSeed: z.boolean(),
        maxCount: z.number().int().min(1).max(15),
        sizes: z
          .array(z.string().regex(/^\d{3,4}x\d{3,4}$/))
          .min(1)
          .max(20)
      })
      .strict()
      .optional()
  })
  .strict()
  .refine((value) => Boolean(value.chat || value.image), {
    message: 'at least one capability profile is required'
  })

export type ProviderCapabilities = z.infer<typeof providerCapabilitiesSchema>
export type ImageCapabilityProfile = NonNullable<ProviderCapabilities['image']>

export { hashSchema }
