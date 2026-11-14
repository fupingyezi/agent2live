import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openDatabase } from '../src/db/client'
import { migrate } from '../src/db/migrate'
import { IdempotencyService } from '../src/services/idempotency'
import { FakeClock } from '../src/services/clock'

const migrations = fileURLToPath(new URL('../migrations', import.meta.url))
let db: ReturnType<typeof openDatabase>
let service: IdempotencyService
let clock: FakeClock

beforeEach(() => {
  db = openDatabase(join(mkdtempSync(join(tmpdir(), 'agent2live-idem-')), 'app.sqlite'))
  migrate(db, migrations)
  clock = new FakeClock(1_000)
  service = new IdempotencyService(db, clock)
})
afterEach(() => db.close())

describe('IdempotencyService', () => {
  it('returns the stored response for the same key and request hash', () => {
    const first = service.run('generation:artp_1', 'k-12345678', 'a'.repeat(64), () => ({
      status: 202,
      body: { jobId: 'job_1' }
    }))
    const second = service.run('generation:artp_1', 'k-12345678', 'a'.repeat(64), () => ({
      status: 500,
      body: { wrong: true }
    }))
    expect(first.replayed).toBe(false)
    expect(second.replayed).toBe(true)
    expect(second.response).toEqual({ status: 202, body: { jobId: 'job_1' } })
  })

  it('rejects reuse with a different request hash', () => {
    service.run('generation:artp_1', 'k-12345678', 'a'.repeat(64), () => ({
      status: 202,
      body: {}
    }))
    expect(() =>
      service.run('generation:artp_1', 'k-12345678', 'b'.repeat(64), () => ({
        status: 202,
        body: {}
      }))
    ).toThrow(/IDEMPOTENCY_KEY_REUSED/)
  })

  it('rolls back the key when the command throws', () => {
    expect(() =>
      service.run('generation:artp_1', 'k-87654321', 'a'.repeat(64), () => {
        throw new Error('side effect failed')
      })
    ).toThrow('side effect failed')
    const result = service.run('generation:artp_1', 'k-87654321', 'a'.repeat(64), () => ({
      status: 202,
      body: { jobId: 'job_2' }
    }))
    expect(result.replayed).toBe(false)
    expect(result.response.body).toEqual({ jobId: 'job_2' })
  })

  it('expires old keys', () => {
    service.run('x', 'k-12345678', 'a'.repeat(64), () => ({ status: 200, body: {} }), { ttlMs: 100 })
    clock.advance(101)
    const result = service.run(
      'x',
      'k-12345678',
      'a'.repeat(64),
      () => ({
        status: 201,
        body: { fresh: true }
      }),
      { ttlMs: 100 }
    )
    expect(result.response.status).toBe(201)
  })
})
