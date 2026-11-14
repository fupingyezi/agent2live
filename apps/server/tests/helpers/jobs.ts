import { z } from 'zod'
import type { JobDefinition } from '../../src/jobs/types'

/** Test-only: production registries must not include test.echo. */
export const TEST_ECHO_JOB: JobDefinition<Record<string, unknown>> = {
  type: 'test.echo',
  payloadSchema: z.record(z.unknown()),
  sideEffect: 'idempotent',
  maxAttempts: 1,
  timeoutMs: 5_000,
  async run(context) {
    context.progress(50, 'halfway')
    return { echoed: context.payload }
  }
}

export function testJobHandlers(): Map<string, JobDefinition> {
  return new Map<string, JobDefinition>([[TEST_ECHO_JOB.type, TEST_ECHO_JOB]])
}
