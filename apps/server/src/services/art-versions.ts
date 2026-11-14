import type Database from 'better-sqlite3'
import {
  artVersionReferenceSetSchema,
  hashCanonical,
  newId,
  type ArtVersionDto,
  type ArtVersionMutationDto,
  type ArtVersionReference,
  type ArtVersionReferenceDto,
  type ReviseArtVersionReferencesInput
} from '@agent2live/contracts'
import { AppError } from '../errors'
import { withEvents } from './events-buffer'
import type { ArtProjectDto, ProjectService } from './projects'
import type { PromptVersionService } from './prompt-versions'
import type { AssetDto, AssetService } from './assets'
import type { AuditService } from './audit'
import type { EventStore } from '../events/store'
import type { Clock } from './clock'
import type { RequestIds } from './request-ids'

export type { ArtVersionDto, ArtVersionMutationDto, ArtVersionReferenceDto }

export interface ArtVersionRow {
  id: string
  art_project_id: string
  version_number: number
  parent_version_id: string | null
  origin_version_id: string | null
  prompt_version_id: string
  source_json: string
  validation_json: string
  canvas_transform_json: string
  content_hash: string
  created_at: number
}

interface AssetLinkRow {
  id: string
  asset_id: string
  role: string
  note: string | null
  weight: number
  sort_order: number
  is_primary: number
  locked: number
}

export function parseObject(json: string, field: string): Record<string, unknown> {
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

export function assertReferenceSet(references: ArtVersionReference[]): void {
  const parsed = artVersionReferenceSetSchema.safeParse(
    references.map((reference) => ({
      assetId: reference.assetId,
      role: reference.role,
      note: reference.note,
      weight: reference.weight,
      sortOrder: reference.sortOrder,
      isPrimary: reference.isPrimary,
      locked: reference.locked
    }))
  )
  if (!parsed.success) {
    throw new AppError('SYS_INTERNAL', { reason: 'art version reference set is invalid' })
  }
}

export function toArtVersionDto(row: ArtVersionRow, links: AssetLinkRow[]): ArtVersionDto {
  const references: ArtVersionReferenceDto[] = links.map((link) => ({
    id: link.id,
    assetId: link.asset_id,
    role: link.role as ArtVersionReferenceDto['role'],
    note: link.note ?? '',
    weight: link.weight,
    sortOrder: link.sort_order,
    isPrimary: link.is_primary === 1,
    locked: link.locked === 1
  }))
  assertReferenceSet(references)
  return {
    id: row.id,
    artProjectId: row.art_project_id,
    versionNumber: row.version_number,
    parentVersionId: row.parent_version_id,
    originVersionId: row.origin_version_id,
    promptVersionId: row.prompt_version_id,
    references,
    source: parseObject(row.source_json, 'source_json'),
    validation: parseObject(row.validation_json, 'validation_json'),
    canvasTransform: parseObject(row.canvas_transform_json, 'canvas_transform_json'),
    contentHash: row.content_hash,
    createdAt: row.created_at
  }
}

export interface ArtVersionServiceDeps {
  db: Database.Database
  clock: Clock
  projects: ProjectService
  promptVersions: PromptVersionService
  assets: AssetService
  audit: AuditService
  events: EventStore
}

export interface ArtVersionReferencesDto {
  artVersionId: string
  references: ArtVersionReferenceDto[]
}

export type ArtVersionSource =
  | { schemaVersion: 'art-source/1'; kind: 'manual_upload'; assetId: string }
  | {
      schemaVersion: 'art-source/1'
      kind: 'generation_candidate'
      candidateId: string
      generationJobId: string
      generationRequestHash: string
    }
  | {
      schemaVersion: 'art-source/1'
      kind: 'reference_revision'
      sourceVersionId: string
      sourceContentHash: string
      reason: ReviseArtVersionReferencesInput['reason']
    }
  | {
      schemaVersion: 'art-source/1'
      kind: 'fork_seed'
      sourceArtVersionId: string
      sourceProjectId: string
      forkId: string
    }

interface ProjectRow {
  id: string
  row_version: number
  deleted_at: number | null
  active_version_id: string | null
  active_prompt_version_id: string | null
  stage: string
}

interface CandidateJoinRow {
  id: string
  generation_job_id: string
  asset_id: string
  validation_json: string
  status: 'ready' | 'accepted' | 'rejected' | 'expired'
  accepted_art_version_id: string | null
  art_project_id: string
  prompt_version_id: string
  request_hash: string
}

export class ArtVersionService {
  constructor(private readonly deps: ArtVersionServiceDeps) {}

  private readReferences(versionId: string): AssetLinkRow[] {
    return this.deps.db
      .prepare(
        `select id, asset_id, role, note, weight, sort_order, is_primary, locked
         from asset_links
         where owner_type = 'art_version' and owner_id = ?
         order by sort_order, id`
      )
      .all(versionId) as AssetLinkRow[]
  }

  active(projectId: string): ArtVersionDto | null {
    const row = this.deps.db
      .prepare(
        `select v.* from art_versions v
         join art_projects p on p.active_version_id = v.id and v.art_project_id = p.id
         where p.id = ? and p.deleted_at is null`
      )
      .get(projectId) as ArtVersionRow | undefined
    return row ? toArtVersionDto(row, this.readReferences(row.id)) : null
  }

  get(projectId: string, versionId: string): ArtVersionDto {
    const row = this.deps.db
      .prepare('select * from art_versions where id = ? and art_project_id = ?')
      .get(versionId, projectId) as ArtVersionRow | undefined
    if (!row) throw new AppError('RESOURCE_NOT_FOUND', { resource: 'artVersion' })
    return toArtVersionDto(row, this.readReferences(row.id))
  }

  list(projectId: string, limit = 50): { items: ArtVersionDto[]; activeVersionId: string | null } {
    const project = this.deps.projects.get(projectId)
    const safeLimit = Math.min(Math.max(limit, 1), 100)
    const rows = this.deps.db
      .prepare(
        `select * from art_versions where art_project_id = ?
         order by version_number desc limit ?`
      )
      .all(projectId, safeLimit) as ArtVersionRow[]
    return {
      items: rows.map((row) => toArtVersionDto(row, this.readReferences(row.id))),
      activeVersionId: project.activeVersionId
    }
  }

  getReferences(versionId: string): ArtVersionReferencesDto {
    const row = this.deps.db
      .prepare(
        `select v.*, p.deleted_at as project_deleted_at
         from art_versions v
         join art_projects p on p.id = v.art_project_id
         where v.id = ?`
      )
      .get(versionId) as (ArtVersionRow & { project_deleted_at: number | null }) | undefined
    if (!row) throw new AppError('RESOURCE_NOT_FOUND', { resource: 'artVersion' })
    if (row.project_deleted_at !== null) {
      throw new AppError('RESOURCE_DELETED', { resource: 'artProject' })
    }
    const dto = toArtVersionDto(row, this.readReferences(row.id))
    return { artVersionId: dto.id, references: dto.references }
  }

  private requireProjectRow(projectId: string, expectedRowVersion?: number): ProjectRow {
    this.deps.projects.getWritable(projectId)
    const row = this.deps.db.prepare('select * from art_projects where id = ?').get(projectId) as
      | ProjectRow
      | undefined
    if (!row) throw new AppError('RESOURCE_NOT_FOUND', { resource: 'artProject' })
    if (expectedRowVersion !== undefined && row.row_version !== expectedRowVersion) {
      throw new AppError('ROW_VERSION_CONFLICT', { expected: expectedRowVersion, actual: row.row_version })
    }
    return row
  }

  private activeRow(projectId: string): ArtVersionRow | null {
    const row = this.deps.db
      .prepare(
        `select v.* from art_versions v
         join art_projects p on p.active_version_id = v.id and v.art_project_id = p.id
         where p.id = ?`
      )
      .get(projectId) as ArtVersionRow | undefined
    return row ?? null
  }

  private nextVersionNumber(projectId: string): number {
    const row = this.deps.db
      .prepare(
        'select coalesce(max(version_number), 0) + 1 as next from art_versions where art_project_id = ?'
      )
      .get(projectId) as { next: number }
    return row.next
  }

  private requireImageAsset(assetId: string): AssetDto {
    const asset = this.deps.assets.getAsset(assetId)
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(asset.mediaType)) {
      throw new AppError('ART_IMAGE_INVALID', { reasons: ['unsupported media type'] })
    }
    if (asset.width === null || asset.height === null || asset.width < 64 || asset.height < 64) {
      throw new AppError('ART_IMAGE_INVALID', { reasons: ['image is too small'] })
    }
    return asset
  }

  private primaryReference(assetId: string): ArtVersionReference {
    return {
      assetId,
      role: 'identity_reference',
      note: '',
      weight: 1,
      sortOrder: 0,
      isPrimary: true,
      locked: false
    }
  }

  private versionReferences(
    projectId: string,
    primaryAssetId: string,
    parentVersionId: string | null
  ): ArtVersionReference[] {
    const auxiliary =
      parentVersionId === null
        ? []
        : this.get(projectId, parentVersionId)
            .references.filter((reference) => !reference.isPrimary && reference.assetId !== primaryAssetId)
            .sort((left, right) => left.sortOrder - right.sortOrder)
    return [
      this.primaryReference(primaryAssetId),
      ...auxiliary.map((reference, index) => ({
        assetId: reference.assetId,
        role: reference.role,
        note: reference.note,
        weight: reference.weight,
        sortOrder: index + 1,
        isPrimary: false,
        locked: reference.locked
      }))
    ]
  }

  private insertVersion(input: {
    projectId: string
    promptVersionId: string
    references: ArtVersionReference[]
    parent: ArtVersionRow | null
    originVersionId?: string
    source: ArtVersionSource
    validation: Record<string, unknown>
    canvasTransform?: Record<string, unknown>
    ctx: RequestIds
  }): string {
    const references = [...input.references].sort((left, right) => left.sortOrder - right.sortOrder)
    assertReferenceSet(references)
    const id = newId('artVersion')
    const now = this.deps.clock.now()
    const canvasTransform = input.canvasTransform ?? { scale: 1, offsetX: 0, offsetY: 0, rotationDeg: 0 }
    const versionNumber = this.nextVersionNumber(input.projectId)
    const originVersionId =
      input.originVersionId ?? (input.parent ? (input.parent.origin_version_id ?? input.parent.id) : id)
    const contentHash = hashCanonical({
      schemaVersion: 'art-version/1',
      promptVersionId: input.promptVersionId,
      references: references.map((reference) => ({
        assetId: reference.assetId,
        role: reference.role,
        note: reference.note,
        weight: reference.weight,
        sortOrder: reference.sortOrder,
        isPrimary: reference.isPrimary,
        locked: reference.locked
      })),
      source: input.source,
      validation: input.validation,
      canvasTransform
    })
    this.deps.db
      .prepare(
        `insert into art_versions
         (id, art_project_id, parent_version_id, origin_version_id, prompt_version_id,
          source_json, validation_json, canvas_transform_json,
          content_hash, version_number, created_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.projectId,
        input.parent?.id ?? null,
        originVersionId,
        input.promptVersionId,
        JSON.stringify(input.source),
        JSON.stringify(input.validation),
        JSON.stringify(canvasTransform),
        contentHash,
        versionNumber,
        now
      )
    for (const reference of references) {
      this.deps.db
        .prepare(
          `insert into asset_links
           (id, asset_id, owner_type, owner_id, role, note, weight, sort_order,
            is_primary, locked, created_at)
           values (?, ?, 'art_version', ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          newId('assetLink'),
          reference.assetId,
          id,
          reference.role,
          reference.note,
          reference.weight,
          reference.sortOrder,
          reference.isPrimary ? 1 : 0,
          reference.locked ? 1 : 0,
          now
        )
    }
    return id
  }

  insertSeededVersion(input: {
    projectId: string
    promptVersionId: string
    originVersionId: string
    references: ArtVersionReference[]
    source: ArtVersionSource
    validation: Record<string, unknown>
    canvasTransform: Record<string, unknown>
    ctx: RequestIds
  }): ArtVersionDto {
    return this.deps.db.transaction(() => {
      const id = this.insertVersion({
        projectId: input.projectId,
        promptVersionId: input.promptVersionId,
        references: input.references,
        parent: null,
        originVersionId: input.originVersionId,
        source: input.source,
        validation: input.validation,
        canvasTransform: input.canvasTransform,
        ctx: input.ctx
      })
      return this.get(input.projectId, id)
    })()
  }

  createManual(input: {
    projectId: string
    assetId: string
    promptVersionId?: string
    role?: ArtVersionReference['role']
    note?: string
    weight?: number
    expectedProjectRowVersion: number
    ctx: RequestIds
  }): ArtVersionMutationDto {
    return withEvents(this.deps.db, this.deps.events, (events) => {
      const project = this.requireProjectRow(input.projectId, input.expectedProjectRowVersion)
      const promptVersionId = input.promptVersionId ?? project.active_prompt_version_id
      if (!promptVersionId) {
        throw new AppError('PROMPT_VERSION_REQUIRED', { artProjectId: input.projectId })
      }
      const promptVersion = this.deps.promptVersions.get(input.projectId, promptVersionId)
      const asset = this.requireImageAsset(input.assetId)
      const parent = this.activeRow(input.projectId)
      const references = this.versionReferences(input.projectId, asset.id, parent?.id ?? null)
      const primary = references[0]!
      if (input.role !== undefined) primary.role = input.role
      if (input.note !== undefined) primary.note = input.note
      if (input.weight !== undefined) primary.weight = input.weight
      const now = this.deps.clock.now()
      const id = this.insertVersion({
        projectId: input.projectId,
        promptVersionId: promptVersion.id,
        references,
        parent,
        source: {
          schemaVersion: 'art-source/1',
          kind: 'manual_upload',
          assetId: asset.id
        },
        validation: {
          schemaVersion: 'art-validation/1',
          status: 'passed',
          width: asset.width,
          height: asset.height,
          mediaType: asset.mediaType,
          sha256: asset.sha256
        },
        ctx: input.ctx
      })
      this.deps.db
        .prepare(
          `update art_projects
           set active_version_id = ?, stage = 'art_version_active',
               updated_at = ?, row_version = row_version + 1
           where id = ?`
        )
        .run(id, now, input.projectId)
      this.deps.audit.append({
        actor: { kind: 'local-user' },
        action: 'art_version.created',
        targetType: 'art_version',
        targetId: id,
        outcome: 'success',
        requestId: input.ctx.requestId,
        traceId: input.ctx.traceId,
        metadata: { kind: 'manual_upload', assetId: asset.id, sourceVersionId: promptVersion.id }
      })
      events.append({
        type: 'artVersion.created',
        scopeKind: 'project',
        scopeId: input.projectId,
        payload: {
          versionId: id,
          kind: 'manual_upload',
          assetId: asset.id,
          previousVersionId: parent?.id ?? null
        },
        requestId: input.ctx.requestId,
        traceId: input.ctx.traceId
      })
      return {
        artVersion: this.get(input.projectId, id),
        project: this.deps.projects.get(input.projectId)
      }
    })
  }

  acceptCandidate(input: {
    candidateId: string
    expectedActiveArtVersionId: string | null
    ctx: RequestIds
  }): ArtVersionMutationDto {
    return withEvents(this.deps.db, this.deps.events, (events) => {
      const candidate = this.deps.db
        .prepare(
          `select c.id, c.generation_job_id, c.asset_id, c.validation_json, c.status,
                  c.accepted_art_version_id, g.art_project_id, g.prompt_version_id, g.request_hash
           from generation_candidates c
           join generation_jobs g on g.id = c.generation_job_id
           where c.id = ?`
        )
        .get(input.candidateId) as CandidateJoinRow | undefined
      if (!candidate) throw new AppError('RESOURCE_NOT_FOUND', { resource: 'generationCandidate' })
      if (candidate.status !== 'ready') {
        throw new AppError('ART_CANDIDATE_NOT_ACCEPTABLE', {
          candidateId: candidate.id,
          status: candidate.status
        })
      }
      const project = this.requireProjectRow(candidate.art_project_id)
      const active = this.activeRow(candidate.art_project_id)
      if ((active?.id ?? null) !== input.expectedActiveArtVersionId) {
        throw new AppError('ART_ACTIVE_VERSION_CHANGED', {
          expected: input.expectedActiveArtVersionId,
          actual: active?.id ?? null
        })
      }
      this.deps.promptVersions.get(candidate.art_project_id, candidate.prompt_version_id)
      const asset = this.requireImageAsset(candidate.asset_id)
      const candidateValidation = parseObject(candidate.validation_json, 'validation_json')
      const references = this.versionReferences(candidate.art_project_id, asset.id, active?.id ?? null)
      const now = this.deps.clock.now()
      const id = this.insertVersion({
        projectId: candidate.art_project_id,
        promptVersionId: candidate.prompt_version_id,
        references,
        parent: active,
        source: {
          schemaVersion: 'art-source/1',
          kind: 'generation_candidate',
          candidateId: candidate.id,
          generationJobId: candidate.generation_job_id,
          generationRequestHash: candidate.request_hash
        },
        validation: {
          schemaVersion: 'art-validation/1',
          status: 'passed',
          width: asset.width,
          height: asset.height,
          mediaType: asset.mediaType,
          sha256: asset.sha256,
          candidateValidation
        },
        ctx: input.ctx
      })
      const changed = this.deps.db
        .prepare(
          `update generation_candidates
           set status = 'accepted', accepted_art_version_id = ?
           where id = ? and status = 'ready'`
        )
        .run(id, candidate.id)
      if (changed.changes !== 1) {
        const current = this.deps.db
          .prepare('select status from generation_candidates where id = ?')
          .get(candidate.id) as { status: 'ready' | 'accepted' | 'rejected' | 'expired' } | undefined
        throw new AppError('ART_CANDIDATE_NOT_ACCEPTABLE', {
          candidateId: candidate.id,
          status: current?.status ?? 'expired'
        })
      }
      this.deps.db
        .prepare(
          `update art_projects
           set active_version_id = ?, stage = 'art_version_active',
               updated_at = ?, row_version = row_version + 1
           where id = ?`
        )
        .run(id, now, project.id)
      this.deps.audit.append({
        actor: { kind: 'local-user' },
        action: 'art_version.accepted',
        targetType: 'art_version',
        targetId: id,
        outcome: 'success',
        requestId: input.ctx.requestId,
        traceId: input.ctx.traceId,
        metadata: {
          candidateId: candidate.id,
          generationJobId: candidate.generation_job_id,
          previousVersionId: active?.id ?? null
        }
      })
      events.append({
        type: 'artVersion.created',
        scopeKind: 'project',
        scopeId: project.id,
        payload: {
          versionId: id,
          kind: 'generation_candidate',
          candidateId: candidate.id,
          generationId: candidate.generation_job_id,
          previousVersionId: active?.id ?? null
        },
        requestId: input.ctx.requestId,
        traceId: input.ctx.traceId
      })
      return {
        artVersion: this.get(project.id, id),
        project: this.deps.projects.get(project.id)
      }
    })
  }

  reviseReferences(input: {
    versionId: string
    references: ArtVersionReference[]
    reason: ReviseArtVersionReferencesInput['reason']
    expectedProjectRowVersion: number
    ctx: RequestIds
  }): ArtVersionMutationDto {
    return withEvents(this.deps.db, this.deps.events, (events) => {
      const parsed = artVersionReferenceSetSchema.safeParse(input.references)
      if (!parsed.success) {
        throw new AppError('ART_REFERENCE_SET_INVALID', {
          reasons: parsed.error.issues.slice(0, 20).map((issue) => issue.message)
        })
      }
      const sourceRow = this.deps.db
        .prepare(
          `select v.*, p.deleted_at as project_deleted_at
           from art_versions v
           join art_projects p on p.id = v.art_project_id
           where v.id = ?`
        )
        .get(input.versionId) as (ArtVersionRow & { project_deleted_at: number | null }) | undefined
      if (!sourceRow) throw new AppError('RESOURCE_NOT_FOUND', { resource: 'artVersion' })
      if (sourceRow.project_deleted_at !== null) {
        throw new AppError('RESOURCE_DELETED', { resource: 'artProject' })
      }
      const project = this.requireProjectRow(sourceRow.art_project_id, input.expectedProjectRowVersion)
      this.get(project.id, sourceRow.id)
      this.deps.promptVersions.get(project.id, sourceRow.prompt_version_id)
      const references: ArtVersionReference[] = [...parsed.data].sort(
        (left, right) => left.sortOrder - right.sortOrder
      )
      for (const reference of references) this.requireImageAsset(reference.assetId)
      const primary = references.find((reference) => reference.isPrimary)
      if (!primary) throw new AppError('ART_REFERENCE_PRIMARY_REQUIRED', {})
      const primaryAsset = this.requireImageAsset(primary.assetId)
      const now = this.deps.clock.now()
      const id = this.insertVersion({
        projectId: project.id,
        promptVersionId: sourceRow.prompt_version_id,
        references,
        parent: sourceRow,
        source: {
          schemaVersion: 'art-source/1',
          kind: 'reference_revision',
          sourceVersionId: sourceRow.id,
          sourceContentHash: sourceRow.content_hash,
          reason: input.reason
        },
        validation: {
          schemaVersion: 'art-validation/1',
          status: 'passed',
          width: primaryAsset.width,
          height: primaryAsset.height,
          mediaType: primaryAsset.mediaType,
          sha256: primaryAsset.sha256
        },
        canvasTransform: parseObject(sourceRow.canvas_transform_json, 'canvas_transform_json'),
        ctx: input.ctx
      })
      const changed =
        project.active_version_id === sourceRow.id
          ? this.deps.db
              .prepare(
                `update art_projects
             set active_version_id = ?, stage = 'art_version_active',
                 updated_at = ?, row_version = row_version + 1
             where id = ? and row_version = ?`
              )
              .run(id, now, project.id, input.expectedProjectRowVersion)
          : this.deps.db
              .prepare(
                `update art_projects
             set updated_at = ?, row_version = row_version + 1
             where id = ? and row_version = ?`
              )
              .run(now, project.id, input.expectedProjectRowVersion)
      if (changed.changes !== 1) {
        throw new AppError('ROW_VERSION_CONFLICT', {
          expected: input.expectedProjectRowVersion
        })
      }
      this.deps.audit.append({
        actor: { kind: 'local-user' },
        action: 'art_version.reference_revision',
        targetType: 'art_version',
        targetId: id,
        outcome: 'success',
        requestId: input.ctx.requestId,
        traceId: input.ctx.traceId,
        metadata: {
          sourceVersionId: sourceRow.id,
          reason: input.reason,
          referenceCount: references.length,
          primaryAssetId: primary.assetId
        }
      })
      events.append({
        type: 'artVersion.created',
        scopeKind: 'project',
        scopeId: project.id,
        payload: {
          versionId: id,
          kind: 'reference_revision',
          sourceVersionId: sourceRow.id,
          reason: input.reason,
          previousVersionId: project.active_version_id
        },
        requestId: input.ctx.requestId,
        traceId: input.ctx.traceId
      })
      return {
        artVersion: this.get(project.id, id),
        project: this.deps.projects.get(project.id)
      }
    })
  }

  activate(input: {
    projectId: string
    versionId: string
    reason: 'switch' | 'rollback'
    expectedProjectRowVersion: number
    ctx: RequestIds
  }): ArtVersionMutationDto {
    return withEvents(this.deps.db, this.deps.events, (events) => {
      const project = this.requireProjectRow(input.projectId, input.expectedProjectRowVersion)
      const target = this.get(input.projectId, input.versionId)
      if (project.active_version_id === target.id) {
        return { artVersion: target, project: this.deps.projects.get(input.projectId) }
      }
      const previousVersionId = project.active_version_id
      const now = this.deps.clock.now()
      const changed = this.deps.db
        .prepare(
          `update art_projects
           set active_version_id = ?, stage = 'art_version_active',
               updated_at = ?, row_version = row_version + 1
           where id = ? and row_version = ?`
        )
        .run(target.id, now, input.projectId, input.expectedProjectRowVersion)
      if (changed.changes !== 1) {
        throw new AppError('ROW_VERSION_CONFLICT', { expected: input.expectedProjectRowVersion })
      }
      this.deps.audit.append({
        actor: { kind: 'local-user' },
        action: 'art_version.activated',
        targetType: 'art_version',
        targetId: target.id,
        outcome: 'success',
        requestId: input.ctx.requestId,
        traceId: input.ctx.traceId,
        metadata: { previousVersionId, reason: input.reason }
      })
      events.append({
        type: 'artVersion.activated',
        scopeKind: 'project',
        scopeId: input.projectId,
        payload: { versionId: target.id, previousVersionId, reason: input.reason },
        requestId: input.ctx.requestId,
        traceId: input.ctx.traceId
      })
      return {
        artVersion: target,
        project: this.deps.projects.get(input.projectId)
      }
    })
  }
}
