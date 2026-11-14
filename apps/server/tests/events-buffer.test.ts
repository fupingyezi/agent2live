import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openDatabase } from '../src/db/client'
import { migrate } from '../src/db/migrate'
import { EventStore } from '../src/events/store'
import { withEvents } from '../src/services/events-buffer'

const migrations = fileURLToPath(new URL('../migrations', import.meta.url))
const dir = mkdtempSync(join(tmpdir(), 'agent2live-evt-'))
const db = openDatabase(join(dir, 'app.sqlite'))
migrate(db, migrations)
const store = new EventStore(db)

afterEach(() => vi.restoreAllMocks())

describe('withEvents', () => {
  it('notifies only after commit and rolls back all events on failure', () => {
    const seen: string[] = []
    const unsubscribe = store.subscribe((event) => seen.push(event.type))
    try {
      expect(() =>
        withEvents(db, store, (events) => {
          events.append({
            type: 'test.committed',
            scopeKind: 'system',
            scopeId: 'test',
            payload: { ok: true }
          })
          throw new Error('boom')
        })
      ).toThrow('boom')
      expect(seen).toEqual([])
      expect(store.listAfter(0).filter((event) => event.type === 'test.committed')).toHaveLength(0)

      const record = withEvents(db, store, (events) => {
        return events.append({
          type: 'test.committed',
          scopeKind: 'system',
          scopeId: 'test',
          payload: { ok: true }
        })
      })
      expect(record.seq).toBeGreaterThan(0)
      expect(seen).toContain('test.committed')
    } finally {
      unsubscribe()
    }
  })

  it('assigns strictly increasing seq inside a transaction', () => {
    const rows = withEvents(db, store, (events) => [
      events.append({ type: 'test.a', scopeKind: 'system', scopeId: 'test', payload: {} }),
      events.append({ type: 'test.b', scopeKind: 'system', scopeId: 'test', payload: {} })
    ])
    expect(rows[0]!.seq).toBeLessThan(rows[1]!.seq)
  })

  it('keeps a committed event when a listener throws', () => {
    const unsubscribe = store.subscribe(() => {
      throw new Error('listener failed')
    })
    try {
      const record = withEvents(db, store, (events) =>
        events.append({ type: 'test.listener', scopeKind: 'system', scopeId: 'test', payload: {} })
      )
      expect(record.seq).toBeGreaterThan(0)
      expect(store.listAfter(0).some((event) => event.seq === record.seq)).toBe(true)
    } finally {
      unsubscribe()
    }
  })
})
