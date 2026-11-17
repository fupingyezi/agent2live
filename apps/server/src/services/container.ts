import type Database from 'better-sqlite3'
import type { Clock } from './clock'
import type { EventStore } from '../events/store'
import type { SecretResolver } from './secret-resolver'
import type { JobDefinition } from '../jobs/types'
import { BlobStore } from './blobs'
import { AssetService } from './assets'
import { AuditService } from './audit'
import { IdempotencyService } from './idempotency'
import { ProviderConnectionService } from './provider-connections'
import { ProviderRegistry } from './provider-registry'
import { ProviderInvocationService } from './provider-invocations'
import { ProviderProbeService } from './provider-probes'
import { CharacterService } from './characters'
import { CharacterBriefService } from './character-briefs'
import { ProjectService } from './projects'
import { ProjectTreeService } from './project-tree'
import { PromptSubmissionRepository } from './prompt-submissions'
import { PromptVersionService } from './prompt-versions'
import { PromptDraftService } from './prompt-drafts'
import { PromptInputService } from './prompt-inputs'
import { PromptReverseService } from './prompt-reverse'
import { PromptSuggestionService } from './prompt-suggestions'
import { PromptSyncService } from './prompt-sync'
import { ArtVersionService } from './art-versions'
import { GenerationService } from './generations'
import { ForkService } from './forks'
import { BackupService } from './backups'
import { JobEngine } from '../jobs/engine'
import { createPromptReverseJob, PROMPT_REVERSE_JOB_TYPE } from '../jobs/prompt-reverse'
import { createPromptSuggestionJob, PROMPT_SUGGESTION_JOB_TYPE } from '../jobs/prompt-suggestion'
import { createPromptSyncJob, PROMPT_SYNC_JOB_TYPE } from '../jobs/prompt-sync'
import { createImageGenerationJob, IMAGE_GENERATION_JOB_TYPE } from '../jobs/image-generation'
import { createCharacterBackupJob, BACKUP_JOB_TYPE } from '../jobs/character-backup'
import { withEvents } from './events-buffer'

export interface ServiceDeps {
  db: Database.Database
  dataDir: string
  events: EventStore
  clock: Clock
  secrets: SecretResolver
  workerId?: string
  maxBackupBytes?: number
  jobHandlers?: ReadonlyMap<string, JobDefinition>
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
  providerProbes: ProviderProbeService
  characters: CharacterService
  briefs: CharacterBriefService
  projects: ProjectService
  projectTree: ProjectTreeService
  submissions: PromptSubmissionRepository
  versions: PromptVersionService
  drafts: PromptDraftService
  inputs: PromptInputService
  reverse: PromptReverseService
  suggestions: PromptSuggestionService
  promptSync: PromptSyncService
  artVersions: ArtVersionService
  generations: GenerationService
  forks: ForkService
  backups: BackupService
  jobs: JobEngine
  withEvents: typeof withEvents
}

export function createServices(deps: ServiceDeps): Services {
  const { db, clock, events, secrets } = deps
  const blobs = new BlobStore(deps.dataDir)
  const audit = new AuditService(db, clock)
  const idempotency = new IdempotencyService(db, clock)
  const assets = new AssetService({ db, blobs, events, audit, clock })
  const providerConnections = new ProviderConnectionService({ db, events, audit, clock })
  const providerRegistry = new ProviderRegistry(providerConnections, secrets)
  const providerInvocations = new ProviderInvocationService(db, clock)
  const providerProbes = new ProviderProbeService({
    connections: providerConnections,
    registry: providerRegistry,
    clock
  })
  const characters = new CharacterService({ db, clock, events, audit })
  const briefs = new CharacterBriefService({ db, clock, events, audit })
  const projects = new ProjectService({ db, clock, events, audit })
  const projectTree = new ProjectTreeService({ db, projects })
  const submissions = new PromptSubmissionRepository(db)
  const versions = new PromptVersionService(db)
  const drafts = new PromptDraftService({
    db,
    clock,
    events,
    audit,
    projects,
    versions,
    submissions,
    briefs
  })
  const inputs = new PromptInputService({
    db,
    assets,
    briefs,
    drafts,
    projects,
    clock,
    events,
    audit,
    submissions
  })
  const reverse = new PromptReverseService({
    db,
    clock,
    drafts,
    submissions,
    briefs,
    assets,
    connections: providerConnections,
    registry: providerRegistry,
    invocations: providerInvocations,
    audit,
    events
  })
  const suggestions = new PromptSuggestionService({
    db,
    clock,
    projects,
    versions,
    drafts,
    submissions,
    briefs,
    connections: providerConnections,
    registry: providerRegistry,
    invocations: providerInvocations,
    audit,
    events
  })
  const promptSync = new PromptSyncService({
    db,
    clock,
    projects,
    drafts,
    submissions,
    briefs,
    connections: providerConnections,
    registry: providerRegistry,
    invocations: providerInvocations,
    audit
  })
  const artVersions = new ArtVersionService({
    db,
    clock,
    projects,
    promptVersions: versions,
    assets,
    audit,
    events
  })
  const generations = new GenerationService({
    db,
    clock,
    projects,
    versions,
    artVersions,
    assets,
    connections: providerConnections,
    registry: providerRegistry,
    invocations: providerInvocations,
    audit,
    events
  })
  const forks = new ForkService({
    db,
    clock,
    projects,
    promptVersions: versions,
    artVersions,
    assets,
    audit,
    events
  })
  const backups = new BackupService({
    db,
    dataDir: deps.dataDir,
    blobs,
    clock,
    audit,
    events,
    ...(deps.maxBackupBytes === undefined ? {} : { maxBytes: deps.maxBackupBytes })
  })

  const handlers = new Map<string, JobDefinition>(deps.jobHandlers ?? [])
  handlers.set(PROMPT_REVERSE_JOB_TYPE, createPromptReverseJob(reverse))
  handlers.set(PROMPT_SUGGESTION_JOB_TYPE, createPromptSuggestionJob(suggestions))
  handlers.set(PROMPT_SYNC_JOB_TYPE, createPromptSyncJob(promptSync))
  handlers.set(IMAGE_GENERATION_JOB_TYPE, createImageGenerationJob(generations))
  handlers.set(BACKUP_JOB_TYPE, createCharacterBackupJob(backups))
  const jobs = new JobEngine({
    db,
    clock,
    events,
    workerId: deps.workerId ?? 'sidecar',
    handlers
  })

  return {
    blobs,
    assets,
    audit,
    idempotency,
    secrets,
    providerConnections,
    providerRegistry,
    providerInvocations,
    providerProbes,
    characters,
    briefs,
    projects,
    projectTree,
    submissions,
    versions,
    drafts,
    inputs,
    reverse,
    suggestions,
    promptSync,
    artVersions,
    generations,
    forks,
    backups,
    jobs,
    withEvents
  }
}
