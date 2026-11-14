import type Database from 'better-sqlite3'
import type { Clock } from './clock'
import type { EventStore } from '../events/store'
import { BlobStore } from './blobs'
import { AssetService } from './assets'
import { AuditService } from './audit'
import { CharacterBriefService } from './character-briefs'
import { CharacterService } from './characters'
import { IdempotencyService } from './idempotency'
import { ProjectTreeService } from './project-tree'
import { ProjectService } from './projects'
import { withEvents } from './events-buffer'
import { ProviderConnectionService } from './provider-connections'
import { ProviderInvocationService } from './provider-invocations'
import { ProviderRegistry } from './provider-registry'
import { JobEngine } from '../jobs/engine'
import type { JobDefinition } from '../jobs/types'
import type { SecretResolver } from './secret-resolver'

export interface ServiceDeps {
  db: Database.Database
  dataDir: string
  events: EventStore
  clock: Clock
  secrets: SecretResolver
  jobHandlers?: ReadonlyMap<string, JobDefinition>
  workerId?: string
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
  jobs: JobEngine
  characters: CharacterService
  characterBriefs: CharacterBriefService
  projects: ProjectService
  projectTree: ProjectTreeService
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
  const characters = new CharacterService({ db: deps.db, clock: deps.clock, events: deps.events, audit })
  const characterBriefs = new CharacterBriefService({
    db: deps.db,
    clock: deps.clock,
    events: deps.events,
    audit
  })
  const projects = new ProjectService({ db: deps.db, clock: deps.clock, events: deps.events, audit })
  const projectTree = new ProjectTreeService({ db: deps.db, projects })
  const handlers = new Map<string, JobDefinition>(deps.jobHandlers ?? [])
  const jobs = new JobEngine({
    db: deps.db,
    events: deps.events,
    clock: deps.clock,
    workerId: deps.workerId ?? 'server',
    handlers
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
    jobs,
    characters,
    characterBriefs,
    projects,
    projectTree,
    withEvents
  }
}
