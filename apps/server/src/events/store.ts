import type Database from 'better-sqlite3'
import { createLogger } from '@agent2live/logging'

export interface EventInput {
  type: string
  scopeKind: 'project' | 'character' | 'job' | 'agent' | 'system'
  scopeId: string
  payload: unknown
  requestId?: string
  traceId?: string
}

export interface EventRecord {
  seq: number
  type: string
  scopeKind: EventInput['scopeKind']
  scopeId: string
  payload: unknown
  requestId: string | null
  traceId: string | null
  createdAt: number
}

export interface AppendOptions {
  notify?: boolean
}

interface EventRow {
  seq: number
  type: string
  scope_kind: EventInput['scopeKind']
  scope_id: string
  payload_json: string
  request_id: string | null
  trace_id: string | null
  created_at: number
}

type Listener = (event: EventRecord) => void

const COLUMNS = 'seq, type, scope_kind, scope_id, payload_json, request_id, trace_id, created_at'
const log = createLogger({ level: process.env.LOG_LEVEL ?? 'info' })

export class EventStore {
  private readonly listeners = new Set<Listener>()
  private readonly insert: Database.Statement
  private readonly selectSeq: Database.Statement

  constructor(
    private readonly db: Database.Database,
    private readonly now: () => number = Date.now
  ) {
    this.insert = db.prepare(
      `insert into event_log (type, scope_kind, scope_id, payload_json, request_id, trace_id, created_at)
       values (@type, @scopeKind, @scopeId, @payloadJson, @requestId, @traceId, @createdAt)`
    )
    this.selectSeq = db.prepare(`select ${COLUMNS} from event_log where seq = ?`)
  }

  append(input: EventInput, options: AppendOptions = {}): EventRecord {
    const result = this.insert.run({
      type: input.type,
      scopeKind: input.scopeKind,
      scopeId: input.scopeId,
      payloadJson: JSON.stringify(input.payload),
      requestId: input.requestId ?? null,
      traceId: input.traceId ?? null,
      createdAt: this.now()
    })
    const row = this.selectSeq.get(Number(result.lastInsertRowid)) as EventRow
    const event = toEventRecord(row)
    if (options.notify !== false) this.notify(event)
    return event
  }

  // A listener failure must not surface as a failed write: the row is already committed
  // and stream clients recover by replaying event_log from their cursor.
  notify(event: EventRecord): void {
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch (error) {
        log.error({ err: error, seq: event.seq, type: event.type }, 'event listener failed')
      }
    }
  }

  listAfter(seq: number, limit = 500): EventRecord[] {
    const rows = this.db
      .prepare(`select ${COLUMNS} from event_log where seq > ? order by seq limit ?`)
      .all(seq, limit) as EventRow[]
    return rows.map(toEventRecord)
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
}

function toEventRecord(row: EventRow): EventRecord {
  return {
    seq: Number(row.seq),
    type: row.type,
    scopeKind: row.scope_kind,
    scopeId: row.scope_id,
    payload: JSON.parse(row.payload_json) as unknown,
    requestId: row.request_id,
    traceId: row.trace_id,
    createdAt: Number(row.created_at)
  }
}
