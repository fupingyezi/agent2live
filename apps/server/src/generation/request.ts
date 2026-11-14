import { z } from 'zod'
import {
  artVersionReferenceRoleSchema,
  artVersionReferenceSetSchema,
  hashCanonical,
  hashSchema
} from '@agent2live/contracts'
import { AppError } from '../errors'

const assetId = z.string().regex(/^ast_[0-9A-HJKMNP-TV-Z]{26}$/)
const generationId = z.string().regex(/^gen_[0-9A-HJKMNP-TV-Z]{26}$/)

export const compiledPromptSnapshotSchema = z
  .object({
    prompt: z.string().max(2_000_000),
    negativePrompt: z.string().max(1_000_000),
    truncated: z.boolean(),
    droppedBlockIds: z.array(z.string().max(100)).max(500),
    warnings: z.array(z.string().max(100)).max(50),
    promptLength: z.number().int().nonnegative()
  })
  .strict()

export const referenceSourceSchema = z.enum(['art_version', 'prompt_material'])
export const referenceWarningSchema = z.enum([
  'reference_budget_exceeded',
  'auxiliary_images_folded',
  'references_ignored_no_image_input'
])

export const generationReferenceSchema = z
  .object({
    assetId,
    source: referenceSourceSchema,
    role: artVersionReferenceRoleSchema,
    note: z.string().max(1000),
    weight: z.number().min(0.1).max(2),
    sortOrder: z.number().int().nonnegative().max(100),
    isPrimary: z.boolean()
  })
  .strict()

export type GenerationReference = z.infer<typeof generationReferenceSchema>

export const referencePlanSchema = z
  .object({
    mode: z.enum(['none', 'full', 'truncated', 'folded_single_image', 'ignored_no_image_input']),
    primaryAssetId: assetId.nullable(),
    requested: z.array(generationReferenceSchema).max(32),
    sentAssetIds: z.array(assetId).max(32),
    foldedAssetIds: z.array(assetId).max(32),
    droppedAssetIds: z.array(assetId).max(32),
    duplicateMaterialAssetIds: z.array(assetId).max(32),
    fingerprint: hashSchema,
    warnings: z.array(referenceWarningSchema).max(2)
  })
  .strict()
  .superRefine((value, ctx) => {
    const requestedIds = value.requested.map((reference) => reference.assetId)
    if (new Set(requestedIds).size !== requestedIds.length) {
      ctx.addIssue({ code: 'custom', message: 'requested references must be unique' })
    }
    const accounted = [...value.sentAssetIds, ...value.foldedAssetIds, ...value.droppedAssetIds]
    if (
      new Set(accounted).size !== accounted.length ||
      accounted.length !== requestedIds.length ||
      accounted.some((id) => !requestedIds.includes(id))
    ) {
      ctx.addIssue({ code: 'custom', message: 'reference plan must partition requested assets' })
    }
    const primaries = value.requested.filter((reference) => reference.isPrimary)
    if (value.primaryAssetId === null) {
      if (primaries.length > 0) {
        ctx.addIssue({ code: 'custom', message: 'primary reference missing from plan' })
      }
    } else if (primaries.length !== 1 || primaries[0]!.assetId !== value.primaryAssetId) {
      ctx.addIssue({ code: 'custom', message: 'primaryAssetId must match the single primary reference' })
    } else if (value.sentAssetIds.length > 0 && value.sentAssetIds[0] !== value.primaryAssetId) {
      ctx.addIssue({ code: 'custom', message: 'primary reference must be sent first' })
    }
    if (value.mode === 'none' && (requestedIds.length > 0 || value.primaryAssetId !== null)) {
      ctx.addIssue({ code: 'custom', message: 'none mode cannot carry references' })
    }
    if (
      value.mode === 'full' &&
      (requestedIds.length === 0 ||
        value.foldedAssetIds.length > 0 ||
        value.droppedAssetIds.length > 0 ||
        value.warnings.length > 0)
    ) {
      ctx.addIssue({ code: 'custom', message: 'full mode requires every reference sent without warnings' })
    }
    if (
      value.mode === 'truncated' &&
      (value.droppedAssetIds.length === 0 ||
        value.foldedAssetIds.length > 0 ||
        !value.warnings.includes('reference_budget_exceeded'))
    ) {
      ctx.addIssue({ code: 'custom', message: 'truncated mode requires dropped assets and its warning' })
    }
    if (
      value.mode === 'folded_single_image' &&
      (value.foldedAssetIds.length === 0 ||
        value.sentAssetIds.length !== 1 ||
        value.droppedAssetIds.length > 0 ||
        !value.warnings.includes('auxiliary_images_folded'))
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'folded mode requires one sent image, folded assets and its warning'
      })
    }
    if (
      value.mode === 'ignored_no_image_input' &&
      (value.sentAssetIds.length > 0 ||
        value.foldedAssetIds.length > 0 ||
        value.droppedAssetIds.length !== requestedIds.length ||
        !value.warnings.includes('references_ignored_no_image_input'))
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'ignored mode must retain the full snapshot without sending images'
      })
    }
    for (const [index, reference] of value.requested.entries()) {
      if (reference.sortOrder !== index) {
        ctx.addIssue({ code: 'custom', message: 'requested references must be ordered by sortOrder' })
        break
      }
    }
  })

export type ReferencePlan = z.infer<typeof referencePlanSchema>

export const generationRequestSchema = z
  .object({
    schemaVersion: z.literal('generation-request/1'),
    generationJobId: generationId,
    artProjectId: z.string().min(1).max(64),
    promptVersionId: z.string().min(1).max(64),
    baseArtVersionId: z.string().min(1).max(64).nullable(),
    providerConnectionId: z.string().min(1).max(64),
    promptContentHash: hashSchema,
    compiled: compiledPromptSnapshotSchema,
    referenceAssetIds: z.array(assetId).max(32),
    primaryReferenceAssetId: assetId.nullable(),
    references: referencePlanSchema,
    count: z.number().int().min(1).max(15),
    size: z.string().regex(/^\d{3,4}x\d{3,4}$/),
    seed: z.number().int().min(0).max(2_147_483_647).nullable(),
    requestHash: hashSchema
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.referenceAssetIds.length !== value.references.sentAssetIds.length ||
      value.referenceAssetIds.some((id, index) => id !== value.references.sentAssetIds[index])
    ) {
      ctx.addIssue({ code: 'custom', message: 'referenceAssetIds must equal references.sentAssetIds' })
    }
    if (value.primaryReferenceAssetId !== value.references.primaryAssetId) {
      ctx.addIssue({
        code: 'custom',
        message: 'primaryReferenceAssetId must equal references.primaryAssetId'
      })
    }
  })

export type GenerationRequest = z.infer<typeof generationRequestSchema>
export type PreparedGeneration = Omit<GenerationRequest, 'schemaVersion' | 'generationJobId' | 'requestHash'>

export interface ManagedReferenceInput {
  assetId: string
  role: string
  note: string
  weight: number
  sortOrder: number
  isPrimary: boolean
}

export interface PromptMaterialReferenceInput {
  assetId: string
  role: string
  note: string
  weight: number
}

export function planReferences(input: {
  activeReferences: ManagedReferenceInput[]
  promptMaterials: PromptMaterialReferenceInput[]
  limit: number
}): ReferencePlan {
  const limit = Math.max(0, Math.floor(input.limit))
  const active = [...input.activeReferences].sort((left, right) => left.sortOrder - right.sortOrder)
  if (
    active.length > 0 &&
    !artVersionReferenceSetSchema.safeParse(
      active.map((reference) => ({
        assetId: reference.assetId,
        role: reference.role,
        note: reference.note,
        weight: reference.weight,
        sortOrder: reference.sortOrder,
        isPrimary: reference.isPrimary
      }))
    ).success
  ) {
    throw new AppError('SYS_INTERNAL', { reason: 'art version reference set is invalid' })
  }

  const duplicateMaterialAssetIds: string[] = []
  const materials: Array<{
    assetId: string
    source: 'prompt_material'
    role: string
    note: string
    weight: number
    sortOrder: number
    isPrimary: boolean
  }> = []
  const seen = new Set(active.map((reference) => reference.assetId))
  for (const material of input.promptMaterials) {
    if (seen.has(material.assetId)) {
      duplicateMaterialAssetIds.push(material.assetId)
      continue
    }
    seen.add(material.assetId)
    materials.push({
      assetId: material.assetId,
      source: 'prompt_material' as const,
      role: material.role,
      note: material.note,
      weight: material.weight,
      sortOrder: 0,
      isPrimary: false
    })
  }

  const parsed = z.array(generationReferenceSchema).safeParse([
    ...active.map((reference) => ({
      assetId: reference.assetId,
      source: 'art_version' as const,
      role: reference.role,
      note: reference.note,
      weight: reference.weight,
      sortOrder: reference.sortOrder,
      isPrimary: reference.isPrimary
    })),
    ...materials
  ])
  if (!parsed.success) {
    throw new AppError('SYS_INTERNAL', { reason: 'generation reference metadata is invalid' })
  }
  const requested = parsed.data.map((reference, sortOrder) => ({ ...reference, sortOrder }))
  const fingerprint = hashCanonical({ schemaVersion: 'generation-references/1', requested })
  const primary = requested.find((reference) => reference.isPrimary) ?? null
  const duplicates = [...new Set(duplicateMaterialAssetIds)]

  if (requested.length === 0) {
    return {
      mode: 'none',
      primaryAssetId: null,
      requested,
      sentAssetIds: [],
      foldedAssetIds: [],
      droppedAssetIds: [],
      duplicateMaterialAssetIds: duplicates,
      fingerprint,
      warnings: []
    }
  }
  if (limit === 0) {
    return {
      mode: 'ignored_no_image_input',
      primaryAssetId: primary?.assetId ?? null,
      requested,
      sentAssetIds: [],
      foldedAssetIds: [],
      droppedAssetIds: requested.map((reference) => reference.assetId),
      duplicateMaterialAssetIds: duplicates,
      fingerprint,
      warnings: ['references_ignored_no_image_input']
    }
  }
  if (requested.length <= limit) {
    return {
      mode: 'full',
      primaryAssetId: primary?.assetId ?? null,
      requested,
      sentAssetIds: requested.map((reference) => reference.assetId),
      foldedAssetIds: [],
      droppedAssetIds: [],
      duplicateMaterialAssetIds: duplicates,
      fingerprint,
      warnings: []
    }
  }
  if (limit === 1) {
    const [sent, ...folded] = requested
    return {
      mode: 'folded_single_image',
      primaryAssetId: primary?.assetId ?? null,
      requested,
      sentAssetIds: [sent!.assetId],
      foldedAssetIds: folded.map((reference) => reference.assetId),
      droppedAssetIds: [],
      duplicateMaterialAssetIds: duplicates,
      fingerprint,
      warnings: ['auxiliary_images_folded']
    }
  }
  const sent = requested.slice(0, limit)
  const dropped = requested.slice(limit)
  return {
    mode: 'truncated',
    primaryAssetId: primary?.assetId ?? null,
    requested,
    sentAssetIds: sent.map((reference) => reference.assetId),
    foldedAssetIds: [],
    droppedAssetIds: dropped.map((reference) => reference.assetId),
    duplicateMaterialAssetIds: duplicates,
    fingerprint,
    warnings: ['reference_budget_exceeded']
  }
}

export function foldedReferenceInstruction(folded: GenerationReference[]): string {
  if (folded.length === 0) return ''
  const lines = folded.map((reference, index) => {
    const note = reference.note.trim().replace(/\s+/g, ' ')
    return `${index + 1}. role=${reference.role}; weight=${reference.weight}; note=${note === '' ? '(none)' : note}`
  })
  return [
    'Additional reference constraints. These images were not sent to the image model; use only the metadata below and do not invent visual details that are absent from it:',
    ...lines
  ].join('\n')
}

export function buildGenerationRequest(
  prepared: PreparedGeneration,
  generationJobId: string
): GenerationRequest {
  const base = { schemaVersion: 'generation-request/1' as const, generationJobId, ...prepared }
  return generationRequestSchema.parse({ ...base, requestHash: hashCanonical(base) })
}
