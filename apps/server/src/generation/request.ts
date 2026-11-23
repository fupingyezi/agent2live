import { z } from 'zod'
import {
  hashCanonical,
  hashSchema,
  imageSizeSchema,
  promptReferenceRoleSchema,
  promptReferenceSetSchema,
  providerModelSelectionSchema,
  type PromptReference
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

export const referenceSourceSchema = z.literal('prompt_version')
export const referenceWarningSchema = z.enum([
  'reference_budget_exceeded',
  'references_ignored_no_image_input'
])

export const generationReferenceSchema = z
  .object({
    assetId,
    source: referenceSourceSchema,
    role: promptReferenceRoleSchema,
    note: z.string().max(1000),
    weight: z.number().min(0.1).max(2),
    locked: z.boolean(),
    sortOrder: z.number().int().nonnegative().max(100)
  })
  .strict()

export type GenerationReference = z.infer<typeof generationReferenceSchema>

export const referencePlanSchema = z
  .object({
    mode: z.enum(['none', 'full', 'truncated', 'ignored_no_image_input']),
    requested: z.array(generationReferenceSchema).max(14),
    sentAssetIds: z.array(assetId).max(14),
    droppedAssetIds: z.array(assetId).max(14),
    fingerprint: hashSchema,
    warnings: z.array(referenceWarningSchema).max(1)
  })
  .strict()
  .superRefine((value, ctx) => {
    const requestedIds = value.requested.map((reference) => reference.assetId)
    if (new Set(requestedIds).size !== requestedIds.length) {
      ctx.addIssue({ code: 'custom', message: 'requested references must be unique' })
    }
    const accounted = [...value.sentAssetIds, ...value.droppedAssetIds]
    if (
      new Set(accounted).size !== accounted.length ||
      accounted.length !== requestedIds.length ||
      accounted.some((id) => !requestedIds.includes(id))
    ) {
      ctx.addIssue({ code: 'custom', message: 'reference plan must partition requested assets' })
    }
    if (
      value.sentAssetIds.some((id, index) => id !== requestedIds[index]) ||
      value.droppedAssetIds.some((id, index) => id !== requestedIds[value.sentAssetIds.length + index])
    ) {
      ctx.addIssue({ code: 'custom', message: 'reference plan must preserve reference order' })
    }
    if (value.mode === 'none' && (requestedIds.length > 0 || value.warnings.length > 0)) {
      ctx.addIssue({ code: 'custom', message: 'none mode cannot carry references' })
    }
    if (
      value.mode === 'full' &&
      (requestedIds.length === 0 || value.droppedAssetIds.length > 0 || value.warnings.length > 0)
    ) {
      ctx.addIssue({ code: 'custom', message: 'full mode requires every reference sent without warnings' })
    }
    if (
      value.mode === 'truncated' &&
      (value.sentAssetIds.length === 0 ||
        value.droppedAssetIds.length === 0 ||
        !value.warnings.includes('reference_budget_exceeded'))
    ) {
      ctx.addIssue({ code: 'custom', message: 'truncated mode requires sent, dropped and its warning' })
    }
    if (
      value.mode === 'ignored_no_image_input' &&
      (value.sentAssetIds.length > 0 ||
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

const generationRequestFields = {
  schemaVersion: z.literal('generation-request/1'),
  generationJobId: generationId,
  artProjectId: z.string().min(1).max(64),
  promptVersionId: z.string().min(1).max(64),
  baseArtVersionId: z.string().min(1).max(64).nullable(),
  providerConnectionId: z.string().min(1).max(64),
  promptContentHash: hashSchema,
  compiled: compiledPromptSnapshotSchema,
  referenceAssetIds: z.array(assetId).max(14),
  references: referencePlanSchema,
  count: z.number().int().min(1).max(15),
  size: imageSizeSchema,
  seed: z.number().int().min(0).max(2_147_483_647).nullable(),
  requestHash: hashSchema
}

/**
 * 严格的任务载荷：新入队任务必须携带模型选择，执行端按此解析。
 * 升级前入队的任务没有 model，会解析失败；开发阶段需在升级时排空或重新入队。
 * 历史记录展示请使用 generationRequestDisplaySchema。
 */
export const generationRequestSchema = z
  .object({ ...generationRequestFields, model: providerModelSelectionSchema })
  .strict()
  .superRefine((value, ctx) => {
    if (value.model.providerConnectionId !== value.providerConnectionId) {
      ctx.addIssue({ code: 'custom', message: 'model selection must match the connection' })
    }
    if (
      value.referenceAssetIds.length !== value.references.sentAssetIds.length ||
      value.referenceAssetIds.some((id, index) => id !== value.references.sentAssetIds[index])
    ) {
      ctx.addIssue({ code: 'custom', message: 'referenceAssetIds must equal references.sentAssetIds' })
    }
  })

/**
 * 仅用于历史记录展示：旧记录的 request_json 没有 model，
 * 但仍应能展示 count/size/seed/warnings；任务执行仍走上面的严格 schema。
 */
export const generationRequestDisplaySchema = z
  .object({ ...generationRequestFields, model: providerModelSelectionSchema.optional() })
  .strict()

export type GenerationRequest = z.infer<typeof generationRequestSchema>
export type GenerationRequestDisplay = z.infer<typeof generationRequestDisplaySchema>
export type PreparedGeneration = Omit<GenerationRequest, 'schemaVersion' | 'generationJobId' | 'requestHash'>

export function planReferences(input: { references: PromptReference[]; limit: number }): ReferencePlan {
  const parsed = promptReferenceSetSchema.safeParse(input.references)
  if (!parsed.success) {
    throw new AppError('SYS_INTERNAL', { reason: 'prompt references are invalid' })
  }
  const requested = parsed.data.map((reference, sortOrder) => ({
    ...reference,
    source: 'prompt_version' as const,
    sortOrder
  }))
  const fingerprint = hashCanonical({ schemaVersion: 'generation-references/2', requested })
  const limit = Math.max(0, Math.floor(input.limit))

  if (requested.length === 0) {
    return {
      mode: 'none',
      requested,
      sentAssetIds: [],
      droppedAssetIds: [],
      fingerprint,
      warnings: []
    }
  }
  if (limit === 0) {
    return {
      mode: 'ignored_no_image_input',
      requested,
      sentAssetIds: [],
      droppedAssetIds: requested.map((reference) => reference.assetId),
      fingerprint,
      warnings: ['references_ignored_no_image_input']
    }
  }
  if (requested.length <= limit) {
    return {
      mode: 'full',
      requested,
      sentAssetIds: requested.map((reference) => reference.assetId),
      droppedAssetIds: [],
      fingerprint,
      warnings: []
    }
  }
  const sent = requested.slice(0, limit)
  const dropped = requested.slice(limit)
  return {
    mode: 'truncated',
    requested,
    sentAssetIds: sent.map((reference) => reference.assetId),
    droppedAssetIds: dropped.map((reference) => reference.assetId),
    fingerprint,
    warnings: ['reference_budget_exceeded']
  }
}

export function buildGenerationRequest(
  prepared: PreparedGeneration,
  generationJobId: string
): GenerationRequest {
  const base = { schemaVersion: 'generation-request/1' as const, generationJobId, ...prepared }
  return generationRequestSchema.parse({ ...base, requestHash: hashCanonical(base) })
}
