import { z } from 'zod'
import { describe, expect, it } from 'vitest'
import { createTestDatabase } from './helpers/app'
import { JobEngine } from '../src/jobs/engine'
import type { JobDefinition, JobTypeRegistry } from '../src/jobs/types'

const echo: JobDefinition = {
  type: 'echo',
  payloadSchema: z.object({ value: z.string() }),
  sideEffect: 'idempotent',
  maxAttempts: 1,
  timeoutMs: 1000,
  run: async () => ({ ok: true })
}

function engine(fixture: ReturnType<typeof createTestDatabase>): JobEngine {
  const handlers: JobTypeRegistry = new Map([['echo', echo]])
  return new JobEngine({
    db: fixture.db,
    events: fixture.eventStore,
    clock: fixture.clock,
    workerId: 'w',
    pollIntervalMs: 10,
    handlers
  })
}

describe('JobEngine enqueue idempotency', () => {
  it('returns the same job for the same key and payload', () => {
    const fixture = createTestDatabase()
    try {
      const jobs = engine(fixture)
      const first = jobs.enqueue({ type: 'echo', payload: { value: 'a' }, idempotencyKey: 'reverse:req-1' })
      const second = jobs.enqueue({ type: 'echo', payload: { value: 'a' }, idempotencyKey: 'reverse:req-1' })
      expect(second.id).toBe(first.id)
      expect(fixture.db.prepare('select count(*) as n from jobs').get()).toEqual({ n: 1 })
      expect(
        fixture.db.prepare("select count(*) as n from event_log where type = 'job.created'").get()
      ).toEqual({ n: 1 })
    } finally {
      fixture.db.close()
    }
  })

  it('rejects reusing a key with a different payload', () => {
    const fixture = createTestDatabase()
    try {
      const jobs = engine(fixture)
      jobs.enqueue({ type: 'echo', payload: { value: 'a' }, idempotencyKey: 'reverse:req-2' })
      expect(() =>
        jobs.enqueue({ type: 'echo', payload: { value: 'b' }, idempotencyKey: 'reverse:req-2' })
      ).toThrow(expect.objectContaining({ code: 'IDEMPOTENCY_KEY_REUSED' }))
    } finally {
      fixture.db.close()
    }
  })
})
