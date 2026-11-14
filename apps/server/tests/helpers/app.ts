import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildApp } from '../../src/app'
import { openDatabase } from '../../src/db/client'
import { migrate } from '../../src/db/migrate'
import { EventStore } from '../../src/events/store'
import { FakeClock } from '../../src/services/clock'
import { createServices, type Services } from '../../src/services/container'
import { StaticSecretResolver, type SecretResolver } from '../../src/services/secret-resolver'
import { testJobHandlers } from './jobs'

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

export async function createTestApp(
  options: { now?: number; services?: Partial<Services>; secrets?: SecretResolver } = {}
): Promise<
  TestDatabase & {
    clock: FakeClock
    services: Services
    secrets: SecretResolver
    app: ReturnType<typeof buildApp>
    auth: { authorization: string }
    close: () => Promise<void>
  }
> {
  const fixture = createTestDatabase()
  if (options.now !== undefined) fixture.clock.set(options.now)
  const clock = fixture.clock
  const events = fixture.eventStore
  const secrets = options.secrets ?? options.services?.secrets ?? new StaticSecretResolver(new Map())
  const services = {
    ...createServices({
      db: fixture.db,
      dataDir: fixture.dataDir,
      events,
      clock,
      secrets,
      jobHandlers: testJobHandlers(),
      workerId: 'test-worker'
    }),
    ...options.services
  }
  const app = buildApp({
    token: 'test-token-0123456789',
    dataDir: fixture.dataDir,
    db: fixture.db,
    eventStore: events,
    services
  })
  await app.ready()
  return {
    ...fixture,
    eventStore: events,
    clock,
    services,
    secrets,
    app,
    auth: { authorization: 'Bearer test-token-0123456789' },
    close: async () => {
      await services.jobs.stop()
      await app.close()
      fixture.db.close()
    }
  }
}

export type TestApp = Awaited<ReturnType<typeof createTestApp>>
