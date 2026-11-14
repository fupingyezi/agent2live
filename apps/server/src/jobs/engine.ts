import type Database from 'better-sqlite3'
import { hashCanonical, newId } from '@agent2live/contracts'
import { AppError } from '../errors'
import type { EventInput, EventStore } from '../events/store'
import type { Clock } from '../services/clock'
import { withEvents } from '../services/events-buffer'
import { normalizeJobError, safeErrorMessage } from './errors'
import type { EnqueueInput, JobDefinition, JobDto, JobEventDto, JobStatus, JobTypeRegistry } from './types'

interface JobRow {
  id: string
  type: string
  status: JobStatus
  payload_json: string
  payload_hash: string
  idempotency_key: string | null
  attempts: number
  max_attempts: number
  lease_owner: string | null
  lease_until: number | null
  cancel_requested_at: number | null
  next_attempt_at: number | null
  checkpoint_json: string | null
  error_json: string | null
  result_json: string | null
  side_effect: 'idempotent' | 'non_idempotent'
  created_at: number
  updated_at: number
}

interface JobEventRow {
  id: string
  seq: number
  type: JobEventDto['type']
  payload_json: string
  created_at: number
}

const TERMINAL: ReadonlySet<JobStatus> = new Set(['succeeded', 'failed', 'cancelled', 'unknown_outcome'])

export interface JobEngineDeps {
  db: Database.Database
  events: EventStore
  clock: Clock
  workerId: string
  handlers: JobTypeRegistry
  pollIntervalMs?: number
  leaseMs?: number
  retryDelayMs?: (attempt: number) => number
}

function hashPayload(payload: unknown): string {
  return hashCanonical(payload)
}

function parseJson<T>(raw: string | null, fallback: T): T {
  if (raw === null) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function toDto(row: JobRow): JobDto {
  const checkpoint = parseJson<{ progress?: unknown }>(row.checkpoint_json, {})
  const error = parseJson<{ code?: unknown }>(row.error_json, {})
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    progress: typeof checkpoint.progress === 'number' ? checkpoint.progress : null,
    errorCode: typeof error.code === 'string' ? error.code : null,
    result: parseJson<unknown>(row.result_json, null),
    cancelRequested: row.cancel_requested_at !== null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export class JobEngine {
  private timer: NodeJS.Timeout | null = null
  private readonly running = new Set<Promise<void>>()
  private stopped = false
  private readonly pollIntervalMs: number
  private readonly leaseMs: number

  constructor(private readonly deps: JobEngineDeps) {
    this.pollIntervalMs = deps.pollIntervalMs ?? 250
    this.leaseMs = deps.leaseMs ?? 5 * 60_000
    for (const [type, definition] of deps.handlers) {
      if (definition.type !== type) {
        throw new Error(`job handler registry key ${type} does not match definition.type ${definition.type}`)
      }
    }
  }

  enqueue(input: EnqueueInput): JobDto {
    const handler = this.handler(input.type)
    const payload = handler.payloadSchema.parse(input.payload)
    const now = this.deps.clock.now()
    return withEvents(this.deps.db, this.deps.events, (events) => {
      const id = newId('job')
      this.deps.db
        .prepare(
          `insert into jobs
           (id, type, status, payload_json, payload_hash, idempotency_key, attempts, max_attempts, side_effect, created_at, updated_at)
           values (?, ?, 'queued', ?, ?, ?, 0, ?, ?, ?, ?)`
        )
        .run(
          id,
          input.type,
          JSON.stringify(payload),
          hashPayload(payload),
          input.idempotencyKey ?? null,
          handler.maxAttempts,
          handler.sideEffect,
          now,
          now
        )
      events.append({
        type: 'job.created',
        scopeKind: 'job',
        scopeId: id,
        payload: { jobId: id, type: input.type }
      })
      return this.get(id)
    })
  }

  get(id: string): JobDto {
    const row = this.deps.db.prepare('select * from jobs where id = ?').get(id) as JobRow | undefined
    if (!row) throw new AppError('RESOURCE_NOT_FOUND', { resource: 'job' })
    return toDto(row)
  }

  listJobEvents(jobId: string, after: number): JobEventDto[] {
    const rows = this.deps.db
      .prepare(
        'select id, seq, type, payload_json, created_at from job_events where job_id = ? and seq > ? order by seq asc'
      )
      .all(jobId, after) as JobEventRow[]
    return rows.map((row) => ({
      id: row.id,
      seq: row.seq,
      type: row.type,
      payload: parseJson<unknown>(row.payload_json, null),
      createdAt: row.created_at
    }))
  }

  start(): void {
    if (this.timer) return
    this.stopped = false
    // Recover dead leases before the first claim so a restart does not wait a poll interval.
    this.recoverExpiredLeases()
    this.timer = setInterval(() => {
      void this.tick().catch(() => undefined)
    }, this.pollIntervalMs)
    this.timer.unref()
  }

  async stop(): Promise<void> {
    this.stopped = true
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    await Promise.allSettled([...this.running])
  }

  async tick(): Promise<void> {
    if (this.stopped) return
    const claimed = this.claim()
    if (!claimed) return
    const task = this.run(claimed).finally(() => this.running.delete(task))
    this.running.add(task)
    await task
  }

  recoverExpiredLeases(): number {
    const now = this.deps.clock.now()
    return withEvents(this.deps.db, this.deps.events, (events) => {
      const expired = this.deps.db
        .prepare(
          `select * from jobs where status in ('leased','running') and lease_until is not null and lease_until < ?`
        )
        .all(now) as JobRow[]
      let changed = 0
      for (const row of expired) {
        if (row.cancel_requested_at !== null) {
          this.deps.db
            .prepare(
              `update jobs set status = 'cancelled', lease_owner = null, lease_until = null, updated_at = ? where id = ?`
            )
            .run(now, row.id)
          this.appendJobEvent(row.id, 'log', { message: 'cancelled' })
          events.append(this.globalEvent('job.cancelled', row, {}))
        } else if (row.side_effect === 'non_idempotent') {
          this.deps.db
            .prepare(
              `update jobs set status = 'unknown_outcome', lease_owner = null, lease_until = null, updated_at = ? where id = ?`
            )
            .run(now, row.id)
          this.appendJobEvent(row.id, 'error', { code: 'UNKNOWN_OUTCOME', retryable: false })
          events.append(this.globalEvent('job.failed', row, { code: 'UNKNOWN_OUTCOME' }))
        } else if (row.attempts < row.max_attempts) {
          this.deps.db
            .prepare(
              `update jobs set status = 'retrying', next_attempt_at = ?, lease_owner = null, lease_until = null, updated_at = ? where id = ?`
            )
            .run(now, now, row.id)
          this.appendJobEvent(row.id, 'error', { code: 'JOB_LEASE_EXPIRED', retryable: true })
          events.append(this.globalEvent('job.retrying', row, { attempt: row.attempts, retryInMs: 0 }))
        } else {
          this.deps.db
            .prepare(
              `update jobs set status = 'failed', lease_owner = null, lease_until = null, updated_at = ? where id = ?`
            )
            .run(now, row.id)
          this.appendJobEvent(row.id, 'error', { code: 'JOB_LEASE_EXPIRED', retryable: false })
          events.append(this.globalEvent('job.failed', row, { code: 'JOB_LEASE_EXPIRED' }))
        }
        changed += 1
      }
      return changed
    })
  }

  cancel(id: string, options: { allowTerminal?: boolean } = {}): JobDto {
    const job = this.get(id)
    if (TERMINAL.has(job.status)) {
      if (options.allowTerminal) return job
      throw new AppError('JOB_CANCEL_NOT_ALLOWED', {
        status: job.status as 'succeeded' | 'failed' | 'cancelled' | 'unknown_outcome'
      })
    }
    const now = this.deps.clock.now()
    return withEvents(this.deps.db, this.deps.events, (events) => {
      if (job.status === 'queued' || job.status === 'retrying' || job.status === 'waiting_user') {
        this.deps.db
          .prepare(
            `update jobs set status = 'cancelled', lease_owner = null, lease_until = null, updated_at = ? where id = ?`
          )
          .run(now, id)
        events.append({
          type: 'job.cancelled',
          scopeKind: 'job',
          scopeId: id,
          payload: { jobId: id }
        })
      } else {
        // Running/leased jobs record the request; the run settles it when the handler returns.
        this.deps.db
          .prepare(
            'update jobs set cancel_requested_at = coalesce(cancel_requested_at, ?), updated_at = ? where id = ?'
          )
          .run(now, now, id)
      }
      return this.get(id)
    })
  }

  private claim(): JobRow | null {
    const now = this.deps.clock.now()
    return this.deps.db.transaction((): JobRow | null => {
      const row = this.deps.db
        .prepare(
          `select * from jobs where status in ('queued','retrying')
           and (next_attempt_at is null or next_attempt_at <= ?)
           and cancel_requested_at is null
           order by created_at, id limit 1`
        )
        .get(now) as JobRow | undefined
      if (!row) return null
      const leaseUntil = now + this.leaseMs
      const result = this.deps.db
        .prepare(
          `update jobs set status = 'leased', lease_owner = ?, lease_until = ?, attempts = attempts + 1, updated_at = ?
           where id = ? and status in ('queued','retrying')`
        )
        .run(this.deps.workerId, leaseUntil, now, row.id)
      if (result.changes !== 1) return null
      return {
        ...row,
        status: 'leased',
        lease_owner: this.deps.workerId,
        lease_until: leaseUntil,
        attempts: row.attempts + 1
      }
    })()
  }

  private async run(row: JobRow): Promise<void> {
    const handler = this.handler(row.type)
    const parsed = handler.payloadSchema.safeParse(parseJson<unknown>(row.payload_json, undefined))
    if (!parsed.success) {
      this.finishFailed(row, 'SYS_INTERNAL', false, 'invalid persisted payload')
      return
    }
    const started = this.deps.clock.now()
    const claimed = this.deps.db
      .prepare(
        `update jobs set status = 'running', lease_until = ?, updated_at = ?
         where id = ? and lease_owner = ? and status = 'leased'`
      )
      .run(started + this.leaseMs, started, row.id, this.deps.workerId)
    if (claimed.changes !== 1) return
    if (this.isCancelRequested(row.id)) {
      this.markCancelled(row)
      return
    }
    this.appendGlobal('job.started', row, { attempt: row.attempts })
    this.appendJobEvent(row.id, 'log', { message: 'started', attempt: row.attempts })

    const controller = new AbortController()
    let timedOut = false
    const timeout = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, handler.timeoutMs)
    timeout.unref()
    try {
      const result = await handler.run({
        jobId: row.id,
        type: row.type,
        payload: parsed.data,
        signal: controller.signal,
        attempt: row.attempts,
        progress: (percent, message) => {
          if (!Number.isFinite(percent)) return
          const value = Math.max(0, Math.min(100, Math.round(percent)))
          this.deps.db
            .prepare('update jobs set checkpoint_json = ?, updated_at = ? where id = ?')
            .run(JSON.stringify({ progress: value, message: message ?? null }), this.deps.clock.now(), row.id)
          this.appendJobEvent(row.id, 'progress', { percent: value, message: message ?? null })
        },
        log: (message, data) => this.appendJobEvent(row.id, 'log', { message, data: data ?? {} })
      })
      if (timedOut) throw new Error('job timed out')
      if (this.isCancelRequested(row.id)) {
        this.markCancelled(row)
        return
      }
      const now = this.deps.clock.now()
      const updated = this.deps.db
        .prepare(
          `update jobs set status = 'succeeded', result_json = ?, error_json = null,
             lease_owner = null, lease_until = null, updated_at = ?
           where id = ? and lease_owner = ? and status = 'running'`
        )
        .run(JSON.stringify(result ?? null), now, row.id, this.deps.workerId)
      if (updated.changes === 1) {
        this.appendJobEvent(row.id, 'done', { result: result ?? null })
        this.appendGlobal('job.succeeded', row, {})
      }
    } catch (error) {
      if (this.isCancelRequested(row.id)) {
        this.markCancelled(row)
        return
      }
      const normalized = timedOut ? { code: 'JOB_TIMEOUT', retryable: true } : normalizeJobError(error)
      const retryable = normalized.retryable && row.attempts < row.max_attempts
      if (retryable) {
        const delay =
          handler.retryDelayMs?.(row.attempts) ??
          this.deps.retryDelayMs?.(row.attempts) ??
          Math.min(30_000, 500 * 2 ** (row.attempts - 1))
        const now = this.deps.clock.now()
        this.deps.db
          .prepare(
            `update jobs set status = 'retrying', next_attempt_at = ?, error_json = ?,
               lease_owner = null, lease_until = null, updated_at = ? where id = ?`
          )
          .run(
            now + delay,
            JSON.stringify({ code: normalized.code, message: safeErrorMessage(error) }),
            now,
            row.id
          )
        this.appendJobEvent(row.id, 'error', { code: normalized.code, retryable: true })
        this.appendGlobal('job.retrying', row, { attempt: row.attempts, retryInMs: delay })
      } else {
        this.finishFailed(row, normalized.code, false, safeErrorMessage(error))
      }
    } finally {
      clearTimeout(timeout)
    }
  }

  private markCancelled(row: JobRow): void {
    const now = this.deps.clock.now()
    const updated = this.deps.db
      .prepare(
        `update jobs set status = 'cancelled', lease_owner = null, lease_until = null, updated_at = ?
         where id = ? and status in ('leased','running')`
      )
      .run(now, row.id)
    if (updated.changes === 1) {
      this.appendJobEvent(row.id, 'log', { message: 'cancelled' })
      this.appendGlobal('job.cancelled', row, {})
    }
  }

  private finishFailed(row: JobRow, code: string, retryable: boolean, message: string): void {
    const now = this.deps.clock.now()
    const updated = this.deps.db
      .prepare(
        `update jobs set status = 'failed', error_json = ?, lease_owner = null, lease_until = null, updated_at = ?
         where id = ? and status in ('leased','running')`
      )
      .run(JSON.stringify({ code, message }), now, row.id)
    if (updated.changes !== 1) return
    this.appendJobEvent(row.id, 'error', { code, retryable })
    this.appendGlobal('job.failed', row, { code })
  }

  private isCancelRequested(id: string): boolean {
    const row = this.deps.db.prepare('select cancel_requested_at from jobs where id = ?').get(id) as
      | { cancel_requested_at: number | null }
      | undefined
    return row !== undefined && row.cancel_requested_at !== null
  }

  private handler(type: string): JobDefinition {
    const handler = this.deps.handlers.get(type)
    if (!handler) {
      throw new AppError('PROVIDER_CAPABILITY_UNSUPPORTED', { capability: `job:${type}` })
    }
    return handler
  }

  private appendJobEvent(jobId: string, type: JobEventDto['type'], payload: unknown): void {
    const next = this.deps.db
      .prepare('select coalesce(max(seq), 0) + 1 as seq from job_events where job_id = ?')
      .get(jobId) as { seq: number }
    this.deps.db
      .prepare(
        'insert into job_events (id, job_id, seq, type, payload_json, created_at) values (?, ?, ?, ?, ?, ?)'
      )
      .run(newId('jobEvent'), jobId, next.seq, type, JSON.stringify(payload), this.deps.clock.now())
  }

  private globalEvent(type: string, row: JobRow, payload: Record<string, unknown>): EventInput {
    return {
      type,
      scopeKind: 'job',
      scopeId: row.id,
      payload: { jobId: row.id, jobType: row.type, ...payload }
    }
  }

  private appendGlobal(type: string, row: JobRow, payload: Record<string, unknown>): void {
    this.deps.events.append(this.globalEvent(type, row, payload))
  }
}
