import { z } from 'zod'
import { providerModelSelectionSchema } from '@agent2live/contracts'
import type { JobDefinition } from './types'
import type { PromptSuggestionService } from '../services/prompt-suggestions'

export const PROMPT_SUGGESTION_JOB_TYPE = 'prompt.suggestion'

const baseSchema = z.object({
  artProjectId: z.string().min(1).max(64),
  providerConnectionId: z.string().min(1).max(64),
  model: providerModelSelectionSchema,
  characterBriefVersionId: z
    .string()
    .regex(/^cbv_[0-9A-HJKMNP-TV-Z]{26}$/)
    .nullable(),
  intent: z.string().trim().min(1).max(2000),
  baseContentHash: z.string().regex(/^[0-9a-f]{64}$/),
  mockProtocol: z.boolean()
})

export const promptSuggestionPayloadSchema = z.discriminatedUnion('baseKind', [
  baseSchema
    .extend({
      baseKind: z.literal('prompt_version'),
      baseVersionId: z.string().min(1).max(64)
    })
    .strict(),
  baseSchema
    .extend({
      baseKind: z.literal('prompt_draft'),
      baseDraftId: z.string().min(1).max(64),
      baseDraftRevision: z.number().int().positive(),
      baseDraftRowVersion: z.number().int().positive()
    })
    .strict()
])

export type PromptSuggestionPayload = z.infer<typeof promptSuggestionPayloadSchema>

export function createPromptSuggestionJob(
  service: PromptSuggestionService
): JobDefinition<PromptSuggestionPayload> {
  return {
    type: PROMPT_SUGGESTION_JOB_TYPE,
    payloadSchema: promptSuggestionPayloadSchema,
    sideEffect: 'idempotent',
    maxAttempts: 2,
    timeoutMs: 90_000,
    run: (context) => service.run(context)
  }
}
