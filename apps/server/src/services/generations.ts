import { createHash } from 'node:crypto'
import type Database from 'better-sqlite3'
import {
  getErrorDefinition,
  newId,
  providerCapabilitiesSchema,
  type ArtProjectStage,
  type CreateGenerationInput,
  type GenerationCandidateDto,
  type GenerationDto as ContractGenerationDto
} from '@agent2live/contracts'
import { AppError } from '../errors'
import {
  providerFailureAppError,
  providerFailureDetail,
  providerFailureMessage
} from './provider-diagnostics'
import { withEvents } from './events-buffer'
import { compilePrompt } from '../prompt/compile'
import { generationRequestSchema, planReferences } from '../generation/request'
import type { GenerationRequest, PreparedGeneration } from '../generation/request'
import type { AssetService } from './assets'
import type { AuditService } from './audit'
import type { Clock } from './clock'
import type { EventStore } from '../events/store'
import type { ProviderConnectionService } from './provider-connections'
import type { ProviderInvocationService } from './provider-invocations'
import type { ProviderRegistry } from './provider-registry'
import type { ProjectService } from './projects'
import type { PromptVersionService } from './prompt-versions'
import type { RequestIds } from './request-ids'
import type { ArtVersionService } from './art-versions'
import type { JobHandlerContext, JobStatus, JobTerminalOutcome } from '../jobs/types'

export interface GenerationServiceDeps {
  db: Database.Database
  clock: Clock
  projects: ProjectService
  versions: PromptVersionService
  artVersions: ArtVersionService
  assets: AssetService
  connections: ProviderConnectionService
  registry: ProviderRegistry
  invocations: ProviderInvocationService
  audit: AuditService
  events: EventStore
}

interface GenerationRow {
  id: string
  art_project_id: string
  prompt_version_id: string
  base_art_version_id: string | null
  provider_connection_id: string | null
  request_json: string
  request_hash: string
  job_id: string
  stage_before: string | null
  created_at: number
}

interface CandidateRow {
  id: string
  generation_job_id: string
  asset_id: string
  validation_json: string
  status: 'ready' | 'accepted' | 'rejected' | 'expired'
  accepted_art_version_id: string | null
  created_at: number
}

interface JobRow {
  id: string
  status: string
  attempts: number
  error_json: string | null
  checkpoint_json: string | null
  updated_at: number
}

export type { GenerationCandidateDto }

export type GenerationDto = Omit<ContractGenerationDto, 'request'> & {
  request: GenerationRequest
}

function parseCheckpoint(json: string | null): { progress: number | null } {
  if (!json) return { progress: null }
  try {
    const value = JSON.parse(json) as { progress?: unknown }
    return { progress: typeof value.progress === 'number' ? value.progress : null }
  } catch {
    return { progress: null }
  }
}

function parseErrorCode(json: string | null): string | null {
  if (!json) return null
  try {
    const value = JSON.parse(json) as { code?: unknown }
    return typeof value.code === 'string' ? value.code : null
  } catch {
    return null
  }
}

function parseErrorMessage(json: string | null): string | null {
  if (!json) return null
  try {
    const value = JSON.parse(json) as { message?: unknown }
    return typeof value.message === 'string' ? value.message : null
  } catch {
    return null
  }
}

const STAGES: ReadonlySet<string> = new Set([
  'idea_draft',
  'prompt_draft',
  'prompt_ready',
  'generating',
  'candidate_review',
  'art_version_active',
  'live2d_pending',
  'blocked'
])

function parseStoredObject(json: string, field: string): Record<string, unknown> {
  let value: unknown
  try {
    value = JSON.parse(json)
  } catch {
    throw new AppError('SYS_INTERNAL', { reason: `${field} is not valid JSON` })
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new AppError('SYS_INTERNAL', { reason: `${field} is not an object` })
  }
  return value as Record<string, unknown>
}

/** Provider failures must never spill raw messages into persisted rows. */
function invocationErrorCode(error: unknown): string {
  const candidate = (error as { code?: unknown }).code
  if (
    typeof candidate === 'string' &&
    candidate.length <= 80 &&
    getErrorDefinition(candidate).code === candidate
  ) {
    return candidate
  }
  return 'SYS_INTERNAL'
}

export class GenerationService {
  constructor(private readonly deps: GenerationServiceDeps) {}

  prepare(projectId: string, input: CreateGenerationInput): PreparedGeneration {
    this.deps.projects.getWritable(projectId)
    const version = this.deps.versions.get(projectId, input.promptVersionId)
    const connection = this.deps.connections.getRow(input.providerConnectionId)
    if (!connection.enabled) {
      throw new AppError('PROVIDER_NOT_CONFIGURED', { connectionId: connection.id })
    }
    if (connection.kind !== 'image') {
      throw new AppError('PROVIDER_CAPABILITY_UNSUPPORTED', { capability: 'image' })
    }
    const capabilities = providerCapabilitiesSchema.parse(JSON.parse(connection.capabilities_json))
    const image = capabilities.image
    if (!image) {
      throw new AppError('PROVIDER_CAPABILITY_UNSUPPORTED', { capability: 'image' })
    }

    if (input.count > image.maxCount) {
      throw new AppError('REQUEST_INVALID', { reason: `count must be <= ${image.maxCount}` })
    }
    const size = input.size ?? image.sizes[0]!
    if (!image.sizes.includes(size)) {
      throw new AppError('REQUEST_INVALID', { reason: `unsupported size ${size}` })
    }
    const seed = input.seed ?? null
    if (seed !== null && !image.supportsSeed) {
      throw new AppError('PROVIDER_CAPABILITY_UNSUPPORTED', { capability: 'image.seed' })
    }

    const compiled = compilePrompt(version.state, image)
    if (compiled.promptLength > image.maxPromptChars) {
      throw new AppError('PROMPT_LENGTH_EXCEEDS_LIMIT', {
        length: compiled.promptLength,
        limit: image.maxPromptChars
      })
    }
    const baseArtVersionId = input.baseArtVersionId ?? null
    if (baseArtVersionId !== null) {
      this.deps.artVersions.get(projectId, baseArtVersionId)
    }
    const referencePlan = planReferences({
      references: version.references,
      limit: image.maxReferenceImages
    })
    for (const reference of referencePlan.requested) {
      this.deps.assets.getAsset(reference.assetId)
    }
    const warnings = [...new Set([...compiled.warnings, ...referencePlan.warnings])]

    return {
      artProjectId: projectId,
      promptVersionId: version.id,
      baseArtVersionId,
      providerConnectionId: connection.id,
      promptContentHash: version.contentHash,
      compiled: { ...compiled, warnings },
      referenceAssetIds: referencePlan.sentAssetIds,
      references: referencePlan,
      count: input.count,
      size,
      seed
    }
  }

  createRecord(request: GenerationRequest, jobId: string, ids: RequestIds): GenerationDto {
    const now = this.deps.clock.now()
    return withEvents(this.deps.db, this.deps.events, (events) => {
      const project = this.deps.db
        .prepare('select stage from art_projects where id = ?')
        .get(request.artProjectId) as { stage: string } | undefined
      if (!project) throw new AppError('RESOURCE_NOT_FOUND', { resource: 'art_project' })
      const stageBefore = project.stage === 'generating' ? null : project.stage
      this.deps.db
        .prepare(
          `insert into generation_jobs
           (id, art_project_id, prompt_version_id, base_art_version_id, provider_connection_id,
            request_json, request_hash, job_id, stage_before, created_at)
           values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          request.generationJobId,
          request.artProjectId,
          request.promptVersionId,
          request.baseArtVersionId,
          request.providerConnectionId,
          JSON.stringify(request),
          request.requestHash,
          jobId,
          stageBefore,
          now
        )
      this.deps.db
        .prepare(
          `update art_projects set stage = 'generating', updated_at = ?, row_version = row_version + 1 where id = ?`
        )
        .run(now, request.artProjectId)
      this.deps.audit.append({
        actor: { kind: 'local-user' },
        action: 'generation.created',
        targetType: 'generation_job',
        targetId: request.generationJobId,
        outcome: 'success',
        requestId: ids.requestId,
        traceId: ids.traceId,
        metadata: {
          sourceVersionId: request.promptVersionId,
          baseArtVersionId: request.baseArtVersionId,
          providerConnectionId: request.providerConnectionId,
          referenceCount: request.referenceAssetIds.length,
          referenceMode: request.references.mode,
          referenceSetHash: request.references.fingerprint,
          referenceDroppedCount: request.references.droppedAssetIds.length
        }
      })
      events.append({
        type: 'generation.created',
        scopeKind: 'project',
        scopeId: request.artProjectId,
        payload: { generationId: request.generationJobId, jobId },
        requestId: ids.requestId,
        traceId: ids.traceId
      })
      return this.get(request.generationJobId)
    })
  }

  get(generationId: string): GenerationDto {
    const row = this.deps.db.prepare('select * from generation_jobs where id = ?').get(generationId) as
      | GenerationRow
      | undefined
    if (!row) throw new AppError('RESOURCE_NOT_FOUND', { resource: 'generation' })
    const job = this.deps.db.prepare('select * from jobs where id = ?').get(row.job_id) as JobRow | undefined
    if (!job) throw new AppError('SYS_INTERNAL', { reason: 'generation job missing' })
    const candidateRows = this.deps.db
      .prepare('select * from generation_candidates where generation_job_id = ? order by created_at, id')
      .all(generationId) as CandidateRow[]
    const assets = this.deps.assets.listByIds(candidateRows.map((candidate) => candidate.asset_id))
    const byId = new Map(assets.map((asset) => [asset.id, asset]))
    const checkpoint = parseCheckpoint(job.checkpoint_json)
    let request: GenerationRequest
    try {
      request = generationRequestSchema.parse(JSON.parse(row.request_json))
    } catch {
      throw new AppError('SYS_INTERNAL', { reason: 'generation request snapshot is invalid' })
    }
    return {
      id: row.id,
      artProjectId: row.art_project_id,
      promptVersionId: row.prompt_version_id,
      baseArtVersionId: row.base_art_version_id,
      providerConnectionId: row.provider_connection_id,
      jobId: row.job_id,
      status: job.status as JobStatus,
      attempts: job.attempts,
      errorCode: parseErrorCode(job.error_json),
      errorMessage: parseErrorMessage(job.error_json),
      progress: checkpoint.progress,
      count: request.count,
      size: request.size,
      seed: request.seed,
      droppedBlockIds: request.compiled.droppedBlockIds,
      compiledWarnings: request.compiled.warnings,
      request,
      requestHash: row.request_hash,
      candidates: candidateRows.map((candidate) => ({
        id: candidate.id,
        generationJobId: candidate.generation_job_id,
        assetId: candidate.asset_id,
        asset: byId.get(candidate.asset_id) ?? null,
        status: candidate.status,
        validation: parseStoredObject(candidate.validation_json, 'validation_json'),
        acceptedArtVersionId: candidate.accepted_art_version_id,
        createdAt: candidate.created_at
      })),
      createdAt: row.created_at,
      updatedAt: job.updated_at
    }
  }

  list(projectId: string, limit: number): { items: GenerationDto[] } {
    this.deps.projects.get(projectId)
    const rows = this.deps.db
      .prepare(
        `select id from generation_jobs
         where art_project_id = ?
         order by created_at desc
         limit ?`
      )
      .all(projectId, limit) as Array<{ id: string }>
    return { items: rows.map((row) => this.get(row.id)) }
  }

  discard(generationId: string, ids: RequestIds): GenerationDto {
    const generation = this.get(generationId)
    withEvents(this.deps.db, this.deps.events, (events) => {
      const changed = this.deps.db
        .prepare(
          `update generation_candidates
           set status = 'rejected'
           where generation_job_id = ? and status = 'ready'`
        )
        .run(generationId)
      if (changed.changes === 0) return
      this.deps.audit.append({
        actor: { kind: 'local-user' },
        action: 'generation.discarded',
        targetType: 'generation_job',
        targetId: generationId,
        outcome: 'success',
        requestId: ids.requestId,
        traceId: ids.traceId,
        metadata: { candidateCount: changed.changes }
      })
      events.append({
        type: 'generation.discarded',
        scopeKind: 'project',
        scopeId: generation.artProjectId,
        payload: { generationId, candidateCount: changed.changes },
        requestId: ids.requestId,
        traceId: ids.traceId
      })
    })
    return this.get(generationId)
  }

  async run(
    context: JobHandlerContext<GenerationRequest>
  ): Promise<{ generationId: string; candidateIds: string[] }> {
    const request = context.payload
    const row = this.deps.db
      .prepare('select * from generation_jobs where id = ?')
      .get(request.generationJobId) as GenerationRow | undefined
    if (!row) throw new AppError('SYS_INTERNAL', { reason: 'generation row missing' })
    if (row.job_id !== context.jobId || row.request_hash !== request.requestHash) {
      throw new AppError('SYS_INTERNAL', { reason: 'generation snapshot mismatch' })
    }
    const existing = this.deps.db
      .prepare('select id from generation_candidates where generation_job_id = ? order by created_at, id')
      .all(request.generationJobId) as Array<{ id: string }>
    if (existing.length > 0) {
      return { generationId: request.generationJobId, candidateIds: existing.map((item) => item.id) }
    }

    const connection = this.deps.connections.getRow(request.providerConnectionId)
    if (!connection.enabled || connection.kind !== 'image') {
      throw new AppError('PROVIDER_NOT_CONFIGURED', { connectionId: connection.id })
    }
    const provider = await this.deps.registry.image(connection.id)
    const planned = new Map(request.references.requested.map((reference) => [reference.assetId, reference]))
    const references = request.referenceAssetIds.map((assetId) => {
      const opened = this.deps.assets.openContent(assetId)
      const reference = planned.get(assetId)
      if (!reference) {
        throw new AppError('SYS_INTERNAL', { reason: 'sent reference missing from plan' })
      }
      return {
        mimeType: opened.asset.mediaType,
        data: opened.bytes,
        role: reference.role,
        weight: reference.weight,
        note: reference.note
      }
    })
    context.progress(10, 'references loaded')
    const invocationId = this.deps.invocations.start({
      connectionId: connection.id,
      purpose: 'image.generate',
      requestHash: request.requestHash,
      model: connection.model
    })
    const startedAt = this.deps.clock.now()
    let providerResult: Awaited<ReturnType<typeof provider.generate>>
    try {
      providerResult = await provider.generate(
        {
          prompt: request.compiled.prompt,
          ...(request.compiled.negativePrompt ? { negativePrompt: request.compiled.negativePrompt } : {}),
          referenceImages: references,
          count: request.count,
          size: request.size,
          ...(request.seed === null ? {} : { seed: request.seed })
        },
        { requestId: context.jobId, signal: context.signal, timeoutMs: 120_000 }
      )
      this.deps.invocations.succeed(invocationId, {
        latencyMs: this.deps.clock.now() - startedAt
      })
    } catch (error) {
      const code = invocationErrorCode(error)
      this.deps.invocations.fail(
        invocationId,
        code,
        this.deps.clock.now() - startedAt,
        providerFailureDetail(error)
      )
      // Rethrow a diagnostic-only error so provider response bodies never reach error_json or logs.
      throw providerFailureAppError(error) ?? new AppError(code, {}, providerFailureMessage(error, code))
    }
    const images = providerResult.images.slice(0, request.count)
    if (images.length === 0) {
      throw new AppError('ART_IMAGE_INVALID', { reasons: ['provider returned no images'] })
    }
    context.progress(60, 'images received')

    const ingested: Array<{
      candidateId: string
      assetId: string
      validation: Record<string, unknown>
    }> = []
    for (const [index, image] of images.entries()) {
      const sha256 = createHash('sha256').update(image.data).digest('hex')
      if (sha256 !== image.sha256) {
        throw new AppError('ART_IMAGE_INVALID', { reasons: ['sha256 mismatch'] })
      }
      if (image.width < 64 || image.height < 64 || image.width > 8192 || image.height > 8192) {
        throw new AppError('ART_IMAGE_INVALID', { reasons: ['dimension out of range'] })
      }
      let asset: Awaited<ReturnType<AssetService['ingestGenerated']>>
      try {
        asset = await this.deps.assets.ingestGenerated({
          bytes: image.data,
          mimeType: image.mimeType,
          sourceRef: `${request.generationJobId}:${index}`,
          modelRef: providerResult.model,
          requestId: context.jobId,
          traceId: context.jobId
        })
      } catch (error) {
        if (error instanceof AppError && error.code.startsWith('ASSET_')) {
          throw new AppError('ART_IMAGE_INVALID', { reasons: ['provider image could not be validated'] })
        }
        // Storage failures are internal; keep their raw messages out of job evidence.
        throw new AppError('SYS_INTERNAL')
      }
      ingested.push({
        candidateId: newId('generationCandidate'),
        assetId: asset.asset.id,
        validation: {
          width: image.width,
          height: image.height,
          mimeType: image.mimeType,
          sha256,
          providerRequestId: providerResult.providerRequestId,
          model: providerResult.model
        }
      })
    }

    const now = this.deps.clock.now()
    withEvents(this.deps.db, this.deps.events, (events) => {
      for (const candidate of ingested) {
        this.deps.db
          .prepare(
            `insert into generation_candidates
             (id, generation_job_id, asset_id, validation_json, status, accepted_art_version_id, created_at)
             values (?, ?, ?, ?, 'ready', null, ?)`
          )
          .run(
            candidate.candidateId,
            request.generationJobId,
            candidate.assetId,
            JSON.stringify(candidate.validation),
            now
          )
      }
      this.deps.db
        .prepare(
          `update art_projects set stage = 'candidate_review', updated_at = ?, row_version = row_version + 1 where id = ?`
        )
        .run(now, request.artProjectId)
      this.deps.audit.append({
        actor: { kind: 'system', component: 'image-generation' },
        action: 'generation.succeeded',
        targetType: 'generation_job',
        targetId: request.generationJobId,
        outcome: 'success',
        requestId: context.jobId,
        traceId: context.jobId,
        metadata: { candidateCount: ingested.length }
      })
      events.append({
        type: 'generation.succeeded',
        scopeKind: 'project',
        scopeId: request.artProjectId,
        payload: {
          generationId: request.generationJobId,
          candidateIds: ingested.map((candidate) => candidate.candidateId)
        },
        requestId: context.jobId,
        traceId: context.jobId
      })
    })
    return {
      generationId: request.generationJobId,
      candidateIds: ingested.map((candidate) => candidate.candidateId)
    }
  }

  /**
   * Restores a truthful project stage when a generation ends without candidates.
   * Runs as a best-effort observer after job settlement; it must never throw.
   */
  onTerminal(outcome: JobTerminalOutcome): void {
    const generation = this.deps.db
      .prepare('select * from generation_jobs where job_id = ?')
      .get(outcome.jobId) as GenerationRow | undefined
    if (!generation) return
    const now = this.deps.clock.now()
    if (outcome.status === 'succeeded') {
      this.deps.db
        .prepare(
          `update art_projects set stage = 'candidate_review', updated_at = ?, row_version = row_version + 1
           where id = ? and stage = 'generating'`
        )
        .run(now, generation.art_project_id)
      return
    }
    const project = this.deps.db
      .prepare('select id, stage, active_version_id, active_prompt_version_id from art_projects where id = ?')
      .get(generation.art_project_id) as
      | {
          id: string
          stage: string
          active_version_id: string | null
          active_prompt_version_id: string | null
        }
      | undefined
    if (!project || project.stage !== 'generating') return
    const stillActive = this.deps.db
      .prepare(
        `select 1
         from generation_jobs gj
         join jobs j on j.id = gj.job_id
         where gj.art_project_id = ? and gj.id <> ?
           and j.status in ('queued', 'leased', 'running', 'waiting_user', 'retrying')
         limit 1`
      )
      .get(project.id, generation.id)
    if (stillActive) return
    const stage = this.rollbackStage(generation, project)
    this.deps.db
      .prepare(
        `update art_projects set stage = ?, updated_at = ?, row_version = row_version + 1
         where id = ? and stage = 'generating'`
      )
      .run(stage, now, project.id)
  }

  private rollbackStage(
    generation: GenerationRow,
    project: {
      id: string
      active_version_id: string | null
      active_prompt_version_id: string | null
    }
  ): ArtProjectStage {
    if (
      generation.stage_before !== null &&
      generation.stage_before !== 'generating' &&
      STAGES.has(generation.stage_before)
    ) {
      return generation.stage_before as ArtProjectStage
    }
    if (project.active_version_id !== null) return 'art_version_active'
    const candidate = this.deps.db
      .prepare(
        `select 1
         from generation_candidates gc
         join generation_jobs gj on gj.id = gc.generation_job_id
         where gj.art_project_id = ?
         limit 1`
      )
      .get(project.id)
    if (candidate) return 'candidate_review'
    if (project.active_prompt_version_id !== null) return 'prompt_ready'
    return 'prompt_draft'
  }
}
