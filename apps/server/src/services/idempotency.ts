import type Database from 'better-sqlite3'
import { AppError } from '../errors'
import type { Clock } from './clock'

export interface IdempotentResponse {
  status: number
  body: unknown
}

export interface IdempotencyResult {
  replayed: boolean
  response: IdempotentResponse
}

interface RunOptions {
  ttlMs?: number
}

interface StoredRow {
  request_hash: string
  status_code: number | null
  response_json: string | null
}

const DAY_MS = 24 * 60 * 60 * 1000

export class IdempotencyService {
  constructor(
    private readonly db: Database.Database,
    private readonly clock: Clock,
    private readonly defaultTtlMs = DAY_MS
  ) {}

  run(
    scope: string,
    key: string,
    requestHash: string,
    execute: () => IdempotentResponse,
    options: RunOptions = {}
  ): IdempotencyResult {
    if (!/^[A-Za-z0-9._:-]{8,128}$/.test(key)) throw new Error('IDEMPOTENCY_KEY_INVALID')
    if (!/^[0-9a-f]{64}$/.test(requestHash)) throw new Error('IDEMPOTENCY_HASH_INVALID')
    const ttlMs = options.ttlMs ?? this.defaultTtlMs
    const now = this.clock.now()
    this.db
      .prepare('delete from idempotency_keys where scope = ? and key = ? and created_at <= ?')
      .run(scope, key, now - ttlMs)

    const existing = this.db
      .prepare(
        'select request_hash, status_code, response_json from idempotency_keys where scope = ? and key = ?'
      )
      .get(scope, key) as StoredRow | undefined
    if (existing) {
      if (existing.request_hash !== requestHash) throw new AppError('IDEMPOTENCY_KEY_REUSED', { scope })
      if (existing.status_code === null || existing.response_json === null) {
        throw new Error('IDEMPOTENCY_IN_PROGRESS')
      }
      return {
        replayed: true,
        response: { status: existing.status_code, body: JSON.parse(existing.response_json) }
      }
    }

    const insert = this.db.prepare(
      'insert into idempotency_keys (scope, key, request_hash, created_at) values (?, ?, ?, ?)'
    )
    const response = this.db.transaction(() => {
      insert.run(scope, key, requestHash, now)
      const result = execute()
      this.db
        .prepare(
          'update idempotency_keys set status_code = ?, response_json = ?, completed_at = ? where scope = ? and key = ?'
        )
        .run(result.status, JSON.stringify(result.body), now, scope, key)
      return result
    })()
    return { replayed: false, response }
  }
}
