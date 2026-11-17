import { z } from 'zod'
import { MATERIAL_ROLES, materialRoleSchema } from './prompt'

export const PROMPT_REFERENCE_ROLES = MATERIAL_ROLES
export const promptReferenceRoleSchema = materialRoleSchema
export type PromptReferenceRole = (typeof PROMPT_REFERENCE_ROLES)[number]

const assetIdSchema = z.string().regex(/^ast_[0-9A-HJKMNP-TV-Z]{26}$/)

export const promptReferenceSchema = z
  .object({
    assetId: assetIdSchema,
    role: materialRoleSchema,
    note: z.string().max(1000).default(''),
    weight: z.number().min(0.1).max(2).default(1),
    locked: z.boolean().default(false)
  })
  .strict()

export type PromptReference = z.infer<typeof promptReferenceSchema>

export const promptReferenceSetSchema = z
  .array(promptReferenceSchema)
  .max(14, { message: 'at most 14 references are allowed' })
  .superRefine((references, ctx) => {
    if (new Set(references.map((item) => item.assetId)).size !== references.length) {
      ctx.addIssue({ code: 'custom', message: 'duplicate reference asset' })
    }
  })
