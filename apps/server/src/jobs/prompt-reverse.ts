import { z } from 'zod'
import type { JobDefinition } from './types'
import type { PromptReverseService } from '../services/prompt-reverse'

export const PROMPT_REVERSE_JOB_TYPE = 'prompt.reverse'

export const promptReversePayloadSchema = z
  .object({
    artProjectId: z.string().min(1).max(64),
    inputSubmissionId: z.string().min(1).max(64),
    characterBriefVersionId: z
      .string()
      .regex(/^cbv_[0-9A-HJKMNP-TV-Z]{26}$/)
      .nullable(),
    baseDraftId: z.string().min(1).max(64),
    baseDraftRevision: z.number().int().positive(),
    baseDraftRowVersion: z.number().int().positive(),
    baseContentHash: z.string().regex(/^[0-9a-f]{64}$/),
    providerConnectionId: z.string().min(1).max(64),
    mockProtocol: z.boolean()
  })
  .strict()

export type PromptReversePayload = z.infer<typeof promptReversePayloadSchema>

export function createPromptReverseJob(service: PromptReverseService): JobDefinition<PromptReversePayload> {
  return {
    type: PROMPT_REVERSE_JOB_TYPE,
    payloadSchema: promptReversePayloadSchema,
    sideEffect: 'idempotent',
    maxAttempts: 2,
    timeoutMs: 240_000,
    run: (context) => service.run(context)
  }
}
