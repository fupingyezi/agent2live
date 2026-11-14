import type Database from 'better-sqlite3'
import type { Clock } from './clock'
import type { EventStore } from '../events/store'
import { BlobStore } from './blobs'
import { AssetService } from './assets'
import { AuditService } from './audit'
import { IdempotencyService } from './idempotency'
import { withEvents } from './events-buffer'
import { ProviderConnectionService } from './provider-connections'
import { ProviderInvocationService } from './provider-invocations'
import { ProviderRegistry } from './provider-registry'
import type { SecretResolver } from './secret-resolver'

export interface ServiceDeps {
  db: Database.Database
  dataDir: string
  events: EventStore
  clock: Clock
  secrets: SecretResolver
}

export interface Services {
  blobs: BlobStore
  assets: AssetService
  audit: AuditService
  idempotency: IdempotencyService
  secrets: SecretResolver
  providerConnections: ProviderConnectionService
  providerRegistry: ProviderRegistry
  providerInvocations: ProviderInvocationService
  withEvents: typeof withEvents
}

export function createServices(deps: ServiceDeps): Services {
  const blobs = new BlobStore(deps.dataDir)
  const audit = new AuditService(deps.db, deps.clock)
  const providerConnections = new ProviderConnectionService({
    db: deps.db,
    events: deps.events,
    audit,
    clock: deps.clock
  })
  return {
    blobs,
    assets: new AssetService({
      db: deps.db,
      blobs,
      events: deps.events,
      audit,
      clock: deps.clock
    }),
    audit,
    idempotency: new IdempotencyService(deps.db, deps.clock),
    secrets: deps.secrets,
    providerConnections,
    providerRegistry: new ProviderRegistry(providerConnections, deps.secrets),
    providerInvocations: new ProviderInvocationService(deps.db, deps.clock),
    withEvents
  }
}
