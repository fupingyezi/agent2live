import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openDatabase } from '../db/client'
import { migrate } from '../db/migrate'
import { EventStore } from '../events/store'
import { formatSseFrame } from '../events/format'

const migrations = fileURLToPath(new URL('../../migrations', import.meta.url))

it('appends, replays, and formats SSE frames', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent2live-events-'))
  const db = openDatabase(join(dir, 'app.sqlite'))
  try {
    migrate(db, migrations)
    const store = new EventStore(db, () => 1_760_000_000_000)
    const first = store.append({
      type: 'job.progress',
      scopeKind: 'job',
      scopeId: 'job_1',
      payload: { value: 1 }
    })
    const second = store.append({
      type: 'job.done',
      scopeKind: 'job',
      scopeId: 'job_1',
      payload: { value: 2 }
    })
    expect(second.seq).toBe(first.seq + 1)
    expect(store.listAfter(0)).toEqual([first, second])
    expect(store.listAfter(first.seq)).toEqual([second])
    const frame = formatSseFrame(second)
    expect(frame).toContain(`id: ${second.seq}\n`)
    expect(frame).toContain('event: job.done\n')
    expect(frame).toContain('"schemaVersion":"event/1"')
    expect(frame.endsWith('\n\n')).toBe(true)
  } finally {
    db.close()
  }
})
