import type Database from 'better-sqlite3'
import type { EventInput, EventRecord, EventStore } from '../events/store'

export class EventBuffer {
  readonly records: EventRecord[] = []

  constructor(
    private readonly db: Database.Database,
    private readonly store: EventStore
  ) {}

  append(input: Omit<EventInput, 'notify'>): EventRecord {
    const record = this.store.append(input, { notify: false })
    this.records.push(record)
    return record
  }

  flush(): void {
    for (const record of this.records) this.store.notify(record)
    this.records.length = 0
  }
}

export function withEvents<T>(db: Database.Database, store: EventStore, fn: (events: EventBuffer) => T): T {
  const buffer = new EventBuffer(db, store)
  const run = db.transaction(() => {
    return fn(buffer)
  })
  let result: T
  try {
    result = run()
  } catch (error) {
    buffer.records.length = 0
    throw error
  }
  buffer.flush()
  return result
}
