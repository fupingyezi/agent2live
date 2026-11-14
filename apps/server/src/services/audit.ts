import type Database from 'better-sqlite3'
import { systemClock, type Clock } from './clock'

export type AuditActor =
  | { kind: 'local-user' }
  | { kind: 'system'; component: string }
  | { kind: 'agent'; taskId: string }

export interface AuditInput {
  actor: AuditActor
  action: string
  targetType: string
  targetId: string
  outcome: 'success' | 'denied' | 'failed'
  requestId: string
  traceId: string
  beforeHash?: string | null
  afterHash?: string | null
  metadata?: Record<string, string | number | boolean | null>
}

const MAX_METADATA_LENGTH = 20_000
// Audit metadata may carry counts, hashes, IDs, and enums, never prompt bodies,
// secrets, or absolute paths.
const FORBIDDEN_METADATA = /(prompt|message|apiKey|secret|\/Users\/)/i

export class AuditService {
  constructor(
    private readonly db: Database.Database,
    private readonly clock: Clock = systemClock
  ) {}

  append(input: AuditInput): void {
    const serialized = JSON.stringify(input.metadata ?? {})
    if (serialized.length > MAX_METADATA_LENGTH) throw new Error('AUDIT_METADATA_TOO_LARGE')
    if (FORBIDDEN_METADATA.test(serialized)) throw new Error('AUDIT_METADATA_FORBIDDEN')
    this.db
      .prepare(
        `insert into audit_events
         (at, actor_json, action, target_type, target_id, outcome, request_id, trace_id, before_hash, after_hash, metadata_json)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        this.clock.now(),
        JSON.stringify(input.actor),
        input.action,
        input.targetType,
        input.targetId,
        input.outcome,
        input.requestId,
        input.traceId,
        input.beforeHash ?? null,
        input.afterHash ?? null,
        serialized
      )
  }
}
