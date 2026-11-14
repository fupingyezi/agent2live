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
import { PromptSubmissionRepository } from './prompt-submissions'
import { PromptVersionService } from './prompt-versions'
import { PromptDraftService } from './prompt-drafts'
import { PromptInputService } from './prompt-inputs'
import { PromptReverseService } from './prompt-reverse'
import { PromptSuggestionService } from './prompt-suggestions'
import { ProviderConnectionService } from './provider-connections'
import { ProviderInvocationService } from './provider-invocations'
import { ProviderRegistry } from './provider-registry'
import { JobEngine } from '../jobs/engine'
import { PROMPT_REVERSE_JOB_TYPE, createPromptReverseJob } from '../jobs/prompt-reverse'
import { PROMPT_SUGGESTION_JOB_TYPE, createPromptSuggestionJob } from '../jobs/prompt-suggestion'
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
  submissions: PromptSubmissionRepository
  versions: PromptVersionService
  drafts: PromptDraftService
  inputs: PromptInputService
  promptReverse: PromptReverseService
  promptSuggestions: PromptSuggestionService
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
  const assets = new AssetService({
    db: deps.db,
    blobs,
    events: deps.events,
    audit,
    clock: deps.clock
  })
  const submissions = new PromptSubmissionRepository(deps.db)
  const versions = new PromptVersionService(deps.db)
  const drafts = new PromptDraftService({
    db: deps.db,
    clock: deps.clock,
    events: deps.events,
    audit,
    projects,
    briefs: characterBriefs,
    versions,
    submissions
  })
  const inputs = new PromptInputService({
    db: deps.db,
    assets,
    briefs: characterBriefs,
    drafts,
    submissions,
    projects,
    clock: deps.clock,
    events: deps.events,
    audit
  })
  const providerRegistry = new ProviderRegistry(providerConnections, deps.secrets)
  const providerInvocations = new ProviderInvocationService(deps.db, deps.clock)
  const promptReverse = new PromptReverseService({
    db: deps.db,
    clock: deps.clock,
    drafts,
    submissions,
    briefs: characterBriefs,
    assets,
    connections: providerConnections,
    registry: providerRegistry,
    invocations: providerInvocations,
    audit,
    events: deps.events
  })
  const promptSuggestions = new PromptSuggestionService({
    db: deps.db,
    clock: deps.clock,
    projects,
    versions,
    drafts,
    submissions,
    briefs: characterBriefs,
    connections: providerConnections,
    registry: providerRegistry,
    invocations: providerInvocations,
    audit,
    events: deps.events
  })
  const handlers = new Map<string, JobDefinition>(deps.jobHandlers ?? [])
  handlers.set(PROMPT_REVERSE_JOB_TYPE, createPromptReverseJob(promptReverse))
  handlers.set(PROMPT_SUGGESTION_JOB_TYPE, createPromptSuggestionJob(promptSuggestions))
  const jobs = new JobEngine({
    db: deps.db,
    events: deps.events,
    clock: deps.clock,
    workerId: deps.workerId ?? 'server',
    handlers
  })
  return {
    blobs,
    assets,
    audit,
    idempotency: new IdempotencyService(deps.db, deps.clock),
    secrets: deps.secrets,
    providerConnections,
    providerRegistry,
    providerInvocations,
    jobs,
    characters,
    characterBriefs,
    projects,
    projectTree,
    submissions,
    versions,
    drafts,
    inputs,
    promptReverse,
    promptSuggestions,
    withEvents
  }
}
