import { z } from 'zod'

export const ART_VERSION_REFERENCE_ROLES = [
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

export const artVersionReferenceRoleSchema = z.enum(ART_VERSION_REFERENCE_ROLES)
const assetIdSchema = z.string().regex(/^ast_[0-9A-HJKMNP-TV-Z]{26}$/)

export const artVersionReferenceSchema = z
  .object({
    assetId: assetIdSchema,
    role: artVersionReferenceRoleSchema,
    note: z.string().max(1000).default(''),
    weight: z.number().min(0.1).max(2).default(1),
    sortOrder: z.number().int().nonnegative().max(100),
    isPrimary: z.boolean(),
    locked: z.boolean().default(false)
  })
  .strict()

export type ArtVersionReference = z.infer<typeof artVersionReferenceSchema>

export const artVersionReferenceSetSchema = z
  .array(artVersionReferenceSchema)
  .min(1, { message: 'at least one reference is required' })
  .max(14, { message: 'at most 14 references are allowed' })
  .superRefine((references, ctx) => {
    const primaries = references.filter((reference) => reference.isPrimary)
    if (primaries.length !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'exactly one primary reference is required',
        path: []
      })
      return
    }
    const primary = primaries[0]!
    if (primary.sortOrder !== 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'primary reference must have sortOrder 0',
        path: []
      })
    }
    const auxiliaryOrders = references
      .filter((reference) => !reference.isPrimary)
      .map((reference) => reference.sortOrder)
      .sort((a, b) => a - b)
    const expectedOrders = Array.from({ length: auxiliaryOrders.length }, (_, index) => index + 1)
    if (auxiliaryOrders.some((order, index) => order !== expectedOrders[index])) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'auxiliary reference order must be continuous 1..N-1',
        path: []
      })
    }
    const assetIds = references.map((reference) => reference.assetId)
    if (new Set(assetIds).size !== assetIds.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'duplicate reference asset',
        path: []
      })
    }
  })

export type ArtVersionReferenceSet = z.infer<typeof artVersionReferenceSetSchema>

export const ART_VERSION_REFERENCE_REVISION_REASONS = [
  'add',
  'remove',
  'reorder',
  'metadata',
  'switch_primary'
] as const

export const reviseArtVersionReferencesInputSchema = z
  .object({
    references: artVersionReferenceSetSchema,
    reason: z.enum(ART_VERSION_REFERENCE_REVISION_REASONS).default('metadata')
  })
  .strict()

export type ReviseArtVersionReferencesInput = z.infer<typeof reviseArtVersionReferencesInputSchema>
