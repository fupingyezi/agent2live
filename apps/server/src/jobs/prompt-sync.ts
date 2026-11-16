import { z } from 'zod'
import { promptSpecSchema } from '@agent2live/contracts'
import type { JobDefinition } from './types'
import type { PromptSyncService } from '../services/prompt-sync'

export const PROMPT_SYNC_JOB_TYPE = 'prompt.sync'

export const promptSyncPayloadSchema = z
  .object({
    artProjectId: z.string().min(1).max(64),
    draftId: z.string().min(1).max(64),
    providerConnectionId: z.string().min(1).max(64),
    characterBriefVersionId: z
      .string()
      .regex(/^cbv_[0-9A-HJKMNP-TV-Z]{26}$/)
      .nullable(),
    source: z.enum(['full', 'blocks']),
    mode: z.enum(['sync', 'optimize']),
    state: promptSpecSchema,
    baseDraftRevision: z.number().int().positive(),
    baseDraftRowVersion: z.number().int().positive(),
    baseContentHash: z.string().regex(/^[0-9a-f]{64}$/),
    mockProtocol: z.boolean()
  })
  .strict()

export type PromptSyncPayload = z.infer<typeof promptSyncPayloadSchema>

export function createPromptSyncJob(service: PromptSyncService): JobDefinition<PromptSyncPayload> {
  return {
    type: PROMPT_SYNC_JOB_TYPE,
    payloadSchema: promptSyncPayloadSchema,
    sideEffect: 'idempotent',
    maxAttempts: 2,
    timeoutMs: 120_000,
    run: (context) => service.run(context)
  }
}
