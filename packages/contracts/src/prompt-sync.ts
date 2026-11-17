import { z } from 'zod'
import { promptOperationSchema, promptSpecSchema, type PromptSpecV2 } from './prompt'

export type PromptEditSource = 'full' | 'blocks' | 'references'

export const promptSyncInputSchema = z
  .object({
    providerConnectionId: z.string().min(1).max(64),
    source: z.enum(['full', 'blocks']),
    mode: z.enum(['sync', 'optimize']).default('sync'),
    state: promptSpecSchema
  })
  .strict()

export const promptSyncConflictSchema = z
  .object({
    blockId: z.string().min(1).max(100),
    message: z.string().trim().min(1).max(500)
  })
  .strict()

export const promptSyncOutputSchema = z
  .object({
    fullPrompt: z.string().trim().min(1).max(20_000),
    operations: z.array(promptOperationSchema).max(200).default([]),
    conflicts: z.array(promptSyncConflictSchema).max(50).default([]),
    warnings: z.array(z.string().max(500)).max(20).default([])
  })
  .strict()

export const promptSyncResultSchema = z
  .object({
    state: promptSpecSchema,
    conflicts: z.array(promptSyncConflictSchema).max(50),
    warnings: z.array(z.string().max(500)).max(20)
  })
  .strict()

export type PromptSyncInput = z.infer<typeof promptSyncInputSchema>
export type PromptSyncConflict = z.infer<typeof promptSyncConflictSchema>
export type PromptSyncOutput = z.infer<typeof promptSyncOutputSchema>
export type PromptSyncResultDto = {
  state: PromptSpecV2
  conflicts: PromptSyncConflict[]
  warnings: string[]
}
