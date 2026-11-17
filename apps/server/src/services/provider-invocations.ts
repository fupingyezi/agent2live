import type Database from 'better-sqlite3'
import { newId } from '@agent2live/contracts'
import type { Clock } from './clock'

export type InvocationPurpose = 'prompt.reverse' | 'prompt.suggestion' | 'image.generate'

export class ProviderInvocationService {
  constructor(
    private readonly db: Database.Database,
    private readonly clock: Clock
  ) {}

  start(input: {
    connectionId: string
    purpose: InvocationPurpose
    requestHash: string
    model: string | null
  }): string {
    const id = newId('providerInvocation')
    this.db
      .prepare(
        `insert into provider_invocations (id, connection_id, purpose, request_hash, status, model, started_at)
         values (?, ?, ?, ?, 'running', ?, ?)`
      )
      .run(id, input.connectionId, input.purpose, input.requestHash, input.model, this.clock.now())
    return id
  }

  succeed(
    id: string,
    usage: { latencyMs: number; inputUnits?: number | null; outputUnits?: number | null }
  ): void {
    this.db
      .prepare(
        `update provider_invocations set status = 'succeeded', latency_ms = ?, input_units = ?, output_units = ?, finished_at = ? where id = ?`
      )
      .run(usage.latencyMs, usage.inputUnits ?? null, usage.outputUnits ?? null, this.clock.now(), id)
  }

  fail(
    id: string,
    errorCode: string,
    latencyMs: number,
    detail: { status: number | null; providerCode: string | null } | null = null
  ): void {
    const detailJson = detail
      ? JSON.stringify({ status: detail.status, providerCode: detail.providerCode })
      : null
    this.db
      .prepare(
        `update provider_invocations set status = 'failed', error_code = ?, error_detail_json = ?, latency_ms = ?, finished_at = ? where id = ?`
      )
      .run(errorCode, detailJson, latencyMs, this.clock.now(), id)
  }

  cancel(id: string, latencyMs: number): void {
    this.db
      .prepare(
        `update provider_invocations set status = 'cancelled', latency_ms = ?, finished_at = ? where id = ?`
      )
      .run(latencyMs, this.clock.now(), id)
  }
}
