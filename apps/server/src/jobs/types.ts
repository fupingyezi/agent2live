import type { JobDto, JobEventDto, JobStatus } from '@agent2live/contracts'
import type { z } from 'zod'

export type { JobDto, JobEventDto, JobStatus }

export type SideEffect = 'idempotent' | 'non_idempotent'

export interface JobHandlerContext<P = unknown> {
  jobId: string
  type: string
  payload: P
  signal: AbortSignal
  attempt: number
  progress(percent: number, message?: string): void
  log(message: string, data?: Record<string, string | number | boolean | null>): void
}

export interface JobHandler<P = unknown> {
  payloadSchema: z.ZodType<P, z.ZodTypeDef, unknown>
  sideEffect: SideEffect
  maxAttempts: number
  timeoutMs: number
  retryDelayMs?(attempt: number): number
  run(context: JobHandlerContext<P>): Promise<unknown>
}

export interface JobDefinition<P = unknown> extends JobHandler<P> {
  type: string
}

/** Registry keys must equal definition.type; the engine validates this at construction. */
export type JobTypeRegistry = ReadonlyMap<string, JobDefinition>

export interface EnqueueInput<P = unknown> {
  type: string
  payload: P
  idempotencyKey?: string
}
