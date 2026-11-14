import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openDatabase } from '../../src/db/client'
import { migrate } from '../../src/db/migrate'
import { EventStore } from '../../src/events/store'
import { FakeClock } from '../../src/services/clock'

const migrations = fileURLToPath(new URL('../../migrations', import.meta.url))

export interface TestDatabase {
  db: ReturnType<typeof openDatabase>
  dataDir: string
  clock: FakeClock
  eventStore: EventStore
}

export function createTestDatabase(): TestDatabase {
  const dataDir = mkdtempSync(join(tmpdir(), 'agent2live-test-'))
  const db = openDatabase(join(dataDir, 'app.sqlite'))
  migrate(db, migrations)
  const clock = new FakeClock(1_700_000_000_000)
  const eventStore = new EventStore(db, () => clock.now())
  return { db, dataDir, clock, eventStore }
}
