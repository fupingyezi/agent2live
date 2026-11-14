import type Database from 'better-sqlite3'
import type { Clock } from './clock'
import type { EventStore } from '../events/store'
import { BlobStore } from './blobs'
import { AssetService } from './assets'
import { AuditService } from './audit'
import { IdempotencyService } from './idempotency'
import { withEvents } from './events-buffer'

export interface ServiceDeps {
  db: Database.Database
  dataDir: string
  events: EventStore
  clock: Clock
}

export interface Services {
  blobs: BlobStore
  assets: AssetService
  audit: AuditService
  idempotency: IdempotencyService
  withEvents: typeof withEvents
}

export function createServices(deps: ServiceDeps): Services {
  const blobs = new BlobStore(deps.dataDir)
  const audit = new AuditService(deps.db, deps.clock)
  return {
    blobs,
    assets: new AssetService({ db: deps.db, blobs, events: deps.events, audit, clock: deps.clock }),
    audit,
    idempotency: new IdempotencyService(deps.db, deps.clock),
    withEvents: withEvents
  }
}
