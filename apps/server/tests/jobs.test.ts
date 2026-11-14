import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { AppError } from '../src/errors'
import { JobEngine } from '../src/jobs/engine'
import type { JobDefinition } from '../src/jobs/types'
import { createTestApp, createTestDatabase } from './helpers/app'
import { TEST_ECHO_JOB } from './helpers/jobs'

describe('JobEngine', () => {
  let fixture: ReturnType<typeof createTestDatabase>
  let engine: JobEngine

  beforeEach(() => {
    fixture = createTestDatabase()
    engine = new JobEngine({
      db: fixture.db,
      events: fixture.eventStore,
      clock: fixture.clock,
      workerId: 'worker-test',
      handlers: new Map<string, JobDefinition>([[TEST_ECHO_JOB.type, TEST_ECHO_JOB]]),
      pollIntervalMs: 10,
      leaseMs: 30_000
    })
  })

  afterEach(async () => {
    await engine.stop()
    fixture.db.close()
  })

  it('runs a queued job, persists result, and emits job events + global events', async () => {
    const job = engine.enqueue({ type: 'test.echo', payload: { hello: 'world' } })
    expect(job.status).toBe('queued')
    await engine.tick()
    const done = engine.get(job.id)
    expect(done.status).toBe('succeeded')
    expect(done.attempts).toBe(1)
    expect(done.result).toEqual({ echoed: { hello: 'world' } })
    const jobEvents = fixture.db
      .prepare('select type, payload_json from job_events where job_id = ? order by seq')
      .all(job.id)
    expect(jobEvents.map((row) => (row as { type: string }).type)).toEqual(['log', 'progress', 'done'])
    const global = fixture.eventStore.listAfter(0).map((event) => event.type)
    expect(global).toEqual(expect.arrayContaining(['job.created', 'job.started', 'job.succeeded']))
  })

  it('retries retryable failures with backoff and succeeds on a later attempt', async () => {
    let attempts = 0
    const flaky: JobDefinition = {
      type: 'test.flaky',
      payloadSchema: z.object({}),
      sideEffect: 'idempotent',
      maxAttempts: 2,
      timeoutMs: 1_000,
      async run() {
        attempts += 1
        if (attempts < 2) throw new Error('transient')
        return { ok: true }
      }
    }
    engine = new JobEngine({
      db: fixture.db,
      events: fixture.eventStore,
      clock: fixture.clock,
      workerId: 'w',
      handlers: new Map<string, JobDefinition>([[flaky.type, flaky]]),
      pollIntervalMs: 10,
      leaseMs: 30_000,
      retryDelayMs: () => 100
    })
    const job = engine.enqueue({ type: 'test.flaky', payload: {} })
    await engine.tick()
    expect(engine.get(job.id).status).toBe('retrying')
    fixture.clock.advance(99)
    await engine.tick()
    expect(engine.get(job.id).status).toBe('retrying')
    fixture.clock.advance(1)
    await engine.tick()
    expect(engine.get(job.id).status).toBe('succeeded')
    expect(engine.get(job.id).attempts).toBe(2)
  })

  it('does not retry non-retryable errors beyond max attempts', async () => {
    const failing: JobDefinition = {
      type: 'test.fail',
      payloadSchema: z.object({}),
      sideEffect: 'idempotent',
      maxAttempts: 3,
      timeoutMs: 1_000,
      async run() {
        throw new AppError('PROVIDER_CONTENT_REJECTED', {})
      }
    }
    engine = new JobEngine({
      db: fixture.db,
      events: fixture.eventStore,
      clock: fixture.clock,
      workerId: 'w',
      handlers: new Map<string, JobDefinition>([[failing.type, failing]]),
      pollIntervalMs: 10,
      leaseMs: 30_000
    })
    const job = engine.enqueue({ type: 'test.fail', payload: {} })
    await engine.tick()
    expect(engine.get(job.id)).toMatchObject({
      status: 'failed',
      errorCode: 'PROVIDER_CONTENT_REJECTED',
      attempts: 1
    })
  })

  it('cancels queued jobs and requests cancellation for running jobs', async () => {
    const queued = engine.enqueue({ type: 'test.echo', payload: {} })
    expect(engine.cancel(queued.id).status).toBe('cancelled')
    expect(() => engine.cancel('job_missing')).toThrow(
      expect.objectContaining({ code: 'RESOURCE_NOT_FOUND' })
    )

    let release!: () => void
    const wait = new Promise<void>((resolve) => {
      release = resolve
    })
    let started!: () => void
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve
    })
    const slow: JobDefinition = {
      type: 'test.slow',
      payloadSchema: z.object({}),
      sideEffect: 'idempotent',
      maxAttempts: 1,
      timeoutMs: 30_000,
      async run(ctx) {
        started()
        await new Promise<void>((resolve, reject) => {
          ctx.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
          void wait.then(resolve)
        })
        return {}
      }
    }
    engine = new JobEngine({
      db: fixture.db,
      events: fixture.eventStore,
      clock: fixture.clock,
      workerId: 'w',
      handlers: new Map<string, JobDefinition>([[slow.type, slow]]),
      pollIntervalMs: 10,
      leaseMs: 30_000
    })
    const running = engine.enqueue({ type: 'test.slow', payload: {} })
    const runningTick = engine.tick()
    await startedPromise
    const cancelled = engine.cancel(running.id)
    expect(cancelled.status).toBe('running')
    expect(cancelled.cancelRequested).toBe(true)
    release()
    await runningTick
    expect(engine.get(running.id)).toMatchObject({ status: 'cancelled', cancelRequested: true })
    expect(() => engine.cancel(running.id, { allowTerminal: false })).toThrow()
  })

  it('returns 404 for unknown jobs and serves per-job events after a cursor', async () => {
    const ctx = await createTestApp()
    try {
      const missing = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/jobs/job_missing',
        headers: ctx.auth
      })
      expect(missing.statusCode).toBe(404)
      expect(missing.json()).toMatchObject({ error: { code: 'RESOURCE_NOT_FOUND' } })

      const job = ctx.services.jobs.enqueue({ type: 'test.echo', payload: { ok: true } })
      await ctx.services.jobs.tick()
      const events = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/jobs/${job.id}/events?after=0`,
        headers: ctx.auth
      })
      expect(events.statusCode).toBe(200)
      const body = events.json<{ items: Array<{ seq: number; type: string }> }>()
      expect(body.items.map((item) => item.type)).toEqual(['log', 'progress', 'done'])
      expect(body.items[0]!.seq).toBeLessThan(body.items[1]!.seq)

      const cursor = body.items[1]!.seq
      const replay = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/jobs/${job.id}/events?after=${cursor}`,
        headers: ctx.auth
      })
      expect(replay.json<{ items: Array<{ seq: number }> }>().items.every((item) => item.seq > cursor)).toBe(
        true
      )
    } finally {
      await ctx.close()
    }
  })

  it('cancels a queued job over HTTP and rejects cancellation after a terminal state', async () => {
    const ctx = await createTestApp()
    try {
      const job = ctx.services.jobs.enqueue({ type: 'test.echo', payload: {} })
      const cancelled = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/jobs/${job.id}/cancel`,
        headers: ctx.auth
      })
      expect(cancelled.statusCode).toBe(200)
      expect(cancelled.json()).toMatchObject({ status: 'cancelled' })

      const again = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/jobs/${job.id}/cancel`,
        headers: ctx.auth
      })
      expect(again.statusCode).toBe(409)
      expect(again.json()).toMatchObject({ error: { code: 'JOB_CANCEL_NOT_ALLOWED' } })
    } finally {
      await ctx.close()
    }
  })

  it('recovers expired idempotent and non-idempotent leases differently', async () => {
    const fixture = createTestDatabase()
    const schema = z.object({})
    const engine = new JobEngine({
      db: fixture.db,
      events: fixture.eventStore,
      clock: fixture.clock,
      workerId: 'w',
      handlers: new Map<string, JobDefinition>([
        [
          'a',
          {
            type: 'a',
            payloadSchema: schema,
            sideEffect: 'idempotent',
            maxAttempts: 2,
            timeoutMs: 1_000,
            run: async () => ({})
          }
        ],
        [
          'b',
          {
            type: 'b',
            payloadSchema: schema,
            sideEffect: 'non_idempotent',
            maxAttempts: 1,
            timeoutMs: 1_000,
            run: async () => ({})
          }
        ]
      ])
    })
    try {
      const a = engine.enqueue({ type: 'a', payload: {} })
      const b = engine.enqueue({ type: 'b', payload: {} })
      fixture.db
        .prepare(
          `update jobs set status = 'leased', lease_owner = 'dead', lease_until = 1, attempts = 1 where id in (?, ?)`
        )
        .run(a.id, b.id)
      expect(engine.recoverExpiredLeases()).toBe(2)
      expect(engine.get(a.id).status).toBe('retrying')
      expect(engine.get(b.id).status).toBe('unknown_outcome')
    } finally {
      await engine.stop()
      fixture.db.close()
    }
  })

  it('recovers expired leases when start is called before the first poll', async () => {
    const fixture = createTestDatabase()
    const engine = new JobEngine({
      db: fixture.db,
      events: fixture.eventStore,
      clock: fixture.clock,
      workerId: 'w',
      pollIntervalMs: 10,
      handlers: new Map<string, JobDefinition>([
        [
          'a',
          {
            type: 'a',
            payloadSchema: z.object({}),
            sideEffect: 'idempotent',
            maxAttempts: 2,
            timeoutMs: 1_000,
            run: async () => ({})
          }
        ]
      ])
    })
    try {
      const job = engine.enqueue({ type: 'a', payload: {} })
      fixture.db
        .prepare(
          `update jobs set status = 'leased', lease_owner = 'dead', lease_until = 1, attempts = 1 where id = ?`
        )
        .run(job.id)
      engine.start()
      expect(engine.get(job.id).status).toBe('retrying')
    } finally {
      await engine.stop()
      fixture.db.close()
    }
  })

  it('buffers recovery global events until commit and scopes them to the job', async () => {
    const fixture = createTestDatabase()
    const reader = new Database(join(fixture.dataDir, 'app.sqlite'))
    const engine = new JobEngine({
      db: fixture.db,
      events: fixture.eventStore,
      clock: fixture.clock,
      workerId: 'w',
      handlers: new Map<string, JobDefinition>([
        [
          'recoverable',
          {
            type: 'recoverable',
            payloadSchema: z.object({}),
            sideEffect: 'idempotent',
            maxAttempts: 2,
            timeoutMs: 1_000,
            run: async () => ({})
          }
        ]
      ])
    })
    try {
      const job = engine.enqueue({ type: 'recoverable', payload: {} })
      fixture.db
        .prepare(
          `update jobs set status = 'running', lease_owner = 'dead', lease_until = 1, attempts = 1 where id = ?`
        )
        .run(job.id)
      const observed: Array<{ status: string | undefined; committedGlobals: number }> = []
      const unsubscribe = fixture.eventStore.subscribe(() => {
        const status = reader.prepare('select status from jobs where id = ?').get(job.id) as
          | { status: string }
          | undefined
        const committed = reader
          .prepare(`select count(*) as count from event_log where type = 'job.retrying' and scope_id = ?`)
          .get(job.id) as { count: number }
        observed.push({ status: status?.status, committedGlobals: committed.count })
      })
      try {
        expect(engine.recoverExpiredLeases()).toBe(1)
      } finally {
        unsubscribe()
      }
      const globals = fixture.eventStore.listAfter(0).filter((event) => event.type === 'job.retrying')
      expect(globals).toHaveLength(1)
      expect(globals[0]).toMatchObject({
        scopeKind: 'job',
        scopeId: job.id,
        payload: { jobId: job.id, jobType: 'recoverable' }
      })
      expect(observed).toEqual([{ status: 'retrying', committedGlobals: 1 }])
      const jobEvent = fixture.db
        .prepare(
          `select payload_json from job_events where job_id = ? and type = 'error' order by seq desc limit 1`
        )
        .get(job.id) as { payload_json: string }
      expect(JSON.parse(jobEvent.payload_json)).toMatchObject({
        code: 'JOB_LEASE_EXPIRED',
        retryable: true
      })
    } finally {
      reader.close()
      await engine.stop()
      fixture.db.close()
    }
  })

  it('maps handler timeouts to retryable JOB_TIMEOUT and exhausts attempts', async () => {
    const waiting: JobDefinition = {
      type: 'test.timeout',
      payloadSchema: z.object({}),
      sideEffect: 'idempotent',
      maxAttempts: 2,
      timeoutMs: 10,
      async run(ctx) {
        await new Promise<void>((_resolve, reject) => {
          ctx.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
        })
      }
    }
    engine = new JobEngine({
      db: fixture.db,
      events: fixture.eventStore,
      clock: fixture.clock,
      workerId: 'w',
      handlers: new Map<string, JobDefinition>([[waiting.type, waiting]]),
      pollIntervalMs: 10,
      leaseMs: 30_000,
      retryDelayMs: () => 0
    })
    const job = engine.enqueue({ type: 'test.timeout', payload: {} })
    await engine.tick()
    expect(engine.get(job.id)).toMatchObject({
      status: 'retrying',
      errorCode: 'JOB_TIMEOUT',
      attempts: 1
    })
    await engine.tick()
    expect(engine.get(job.id)).toMatchObject({
      status: 'failed',
      errorCode: 'JOB_TIMEOUT',
      attempts: 2
    })
  })

  it('redacts secrets from persisted job errors and job events', async () => {
    const secret = 'sk-live-abcdefgh12345678'
    const bearer = 'top-secret-token-value'
    const failing: JobDefinition = {
      type: 'test.leaky',
      payloadSchema: z.object({}),
      sideEffect: 'idempotent',
      maxAttempts: 1,
      timeoutMs: 1_000,
      async run() {
        throw new Error(`upstream rejected: apiKey=${secret} Authorization: Bearer ${bearer}`)
      }
    }
    engine = new JobEngine({
      db: fixture.db,
      events: fixture.eventStore,
      clock: fixture.clock,
      workerId: 'w',
      handlers: new Map<string, JobDefinition>([[failing.type, failing]]),
      pollIntervalMs: 10,
      leaseMs: 30_000
    })
    const job = engine.enqueue({ type: 'test.leaky', payload: {} })
    await engine.tick()
    expect(engine.get(job.id)).toMatchObject({ status: 'failed', errorCode: 'SYS_INTERNAL' })
    const stored = fixture.db.prepare('select error_json from jobs where id = ?').get(job.id) as {
      error_json: string
    }
    expect(stored.error_json).toContain('[REDACTED]')
    expect(stored.error_json).not.toContain(secret)
    expect(stored.error_json).not.toContain(bearer)
    const jobEvents = JSON.stringify(
      fixture.db.prepare('select payload_json from job_events where job_id = ?').all(job.id)
    )
    expect(jobEvents).not.toContain(secret)
    expect(jobEvents).not.toContain(bearer)
    const globalEvents = JSON.stringify(fixture.eventStore.listAfter(0))
    expect(globalEvents).not.toContain(secret)
    expect(globalEvents).not.toContain(bearer)
  })
})
