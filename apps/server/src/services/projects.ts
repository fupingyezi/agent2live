import type Database from 'better-sqlite3'
import { hashCanonical, newId, type CreateArtProjectInput } from '@agent2live/contracts'
import { AppError } from '../errors'
import type { EventStore } from '../events/store'
import type { AuditService } from './audit'
import type { Clock } from './clock'
import { withEvents } from './events-buffer'
import { projectForkSlice } from './fork-query'
import type { RequestIds } from './request-ids'

export interface ProjectForkSlice {
  forkId: string
  parentProjectId: string
  rootProjectId: string
  sourceKind: 'prompt_version' | 'art_version'
  sourceVersionId: string
  branchLabel: string
  status: 'active' | 'detached'
  parentDeleted: boolean
}

export interface ArtProjectDto {
  id: string
  characterId: string
  title: string
  description: string | null
  stage: string
  activeVersionId: string | null
  activePromptVersionId: string | null
  forkedFrom: ProjectForkSlice | null
  createdAt: number
  updatedAt: number
  rowVersion: number
  deletedAt: number | null
}

interface ProjectRow {
  id: string
  character_id: string
  title: string
  description: string | null
  stage: string
  active_version_id: string | null
  active_prompt_version_id: string | null
  created_at: number
  updated_at: number
  deleted_at: number | null
  row_version: number
}

export interface ProjectDeps {
  db: Database.Database
  clock: Clock
  events: EventStore
  audit: AuditService
}

export interface ProjectPatch {
  title?: string | undefined
  description?: string | null | undefined
}

export class ProjectService {
  constructor(private readonly deps: ProjectDeps) {}

  get(id: string, options: { includeDeleted?: boolean } = {}): ArtProjectDto {
    const row = this.deps.db.prepare('select * from art_projects where id = ?').get(id) as
      | ProjectRow
      | undefined
    if (!row) throw new AppError('RESOURCE_NOT_FOUND', { resource: 'artProject' })
    if (row.deleted_at !== null && !options.includeDeleted) {
      throw new AppError('RESOURCE_DELETED', { resource: 'artProject' })
    }
    return this.toDto(row)
  }

  getWritable(id: string): ArtProjectDto {
    return this.get(id)
  }

  create(characterId: string, input: CreateArtProjectInput, ids: RequestIds): ArtProjectDto {
    return withEvents(this.deps.db, this.deps.events, (events) => {
      const character = this.deps.db
        .prepare('select deleted_at from characters where id = ?')
        .get(characterId) as { deleted_at: number | null } | undefined
      if (!character) throw new AppError('RESOURCE_NOT_FOUND', { resource: 'character' })
      if (character.deleted_at !== null) throw new AppError('RESOURCE_DELETED', { resource: 'character' })
      const id = newId('artProject')
      const now = this.deps.clock.now()
      this.deps.db
        .prepare(
          `insert into art_projects
           (id, character_id, title, description, stage, active_version_id, active_prompt_version_id, created_at, updated_at, row_version)
           values (?, ?, ?, ?, 'idea_draft', NULL, NULL, ?, ?, 1)`
        )
        .run(id, characterId, input.title, input.description ?? null, now, now)
      this.deps.audit.append({
        actor: { kind: 'local-user' },
        action: 'project.created',
        targetType: 'art_project',
        targetId: id,
        outcome: 'success',
        requestId: ids.requestId,
        traceId: ids.traceId,
        metadata: {}
      })
      events.append({
        type: 'project.created',
        scopeKind: 'project',
        scopeId: id,
        payload: { projectId: id, characterId },
        requestId: ids.requestId,
        traceId: ids.traceId
      })
      return this.get(id)
    })
  }

  update(id: string, patch: ProjectPatch, expectedRowVersion: number, ids: RequestIds): ArtProjectDto {
    return withEvents(this.deps.db, this.deps.events, (events) => {
      const current = this.getWritable(id)
      const updated = this.deps.db
        .prepare(
          `update art_projects set title = ?, description = ?, updated_at = ?, row_version = row_version + 1
           where id = ? and row_version = ? and deleted_at is null`
        )
        .run(
          patch.title ?? current.title,
          patch.description === undefined ? current.description : patch.description,
          this.deps.clock.now(),
          id,
          expectedRowVersion
        )
      if (updated.changes !== 1) throw new AppError('ROW_VERSION_CONFLICT', { expected: expectedRowVersion })
      const after = this.get(id)
      this.deps.audit.append({
        actor: { kind: 'local-user' },
        action: 'project.updated',
        targetType: 'art_project',
        targetId: id,
        outcome: 'success',
        requestId: ids.requestId,
        traceId: ids.traceId,
        beforeHash: hashCanonical({ title: current.title, description: current.description }),
        afterHash: hashCanonical({ title: after.title, description: after.description }),
        metadata: {}
      })
      events.append({
        type: 'project.updated',
        scopeKind: 'project',
        scopeId: id,
        payload: { projectId: id, rowVersion: after.rowVersion },
        requestId: ids.requestId,
        traceId: ids.traceId
      })
      return after
    })
  }

  softDelete(id: string, expectedRowVersion: number, ids: RequestIds): void {
    withEvents(this.deps.db, this.deps.events, (events) => {
      this.getWritable(id)
      const activeJobs = this.deps.db
        .prepare(
          `select id from jobs
           where status in ('queued','leased','running','retrying','waiting_user')
             and json_extract(payload_json, '$.artProjectId') = ?`
        )
        .all(id) as Array<{ id: string }>
      if (activeJobs.length > 0) {
        throw new AppError('PROJECT_HAS_ACTIVE_JOBS', {
          jobIds: activeJobs.map((job) => job.id).slice(0, 20)
        })
      }
      const now = this.deps.clock.now()
      const updated = this.deps.db
        .prepare(
          `update art_projects set deleted_at = ?, updated_at = ?, row_version = row_version + 1
           where id = ? and row_version = ? and deleted_at is null`
        )
        .run(now, now, id, expectedRowVersion)
      if (updated.changes !== 1) throw new AppError('ROW_VERSION_CONFLICT', { expected: expectedRowVersion })
      this.deps.audit.append({
        actor: { kind: 'local-user' },
        action: 'project.deleted',
        targetType: 'art_project',
        targetId: id,
        outcome: 'success',
        requestId: ids.requestId,
        traceId: ids.traceId,
        metadata: {}
      })
      events.append({
        type: 'project.deleted',
        scopeKind: 'project',
        scopeId: id,
        payload: { projectId: id },
        requestId: ids.requestId,
        traceId: ids.traceId
      })
    })
  }

  private toDto(row: ProjectRow): ArtProjectDto {
    return {
      id: row.id,
      characterId: row.character_id,
      title: row.title,
      description: row.description,
      stage: row.stage,
      activeVersionId: row.active_version_id,
      activePromptVersionId: row.active_prompt_version_id,
      forkedFrom: projectForkSlice(this.deps.db, row.id),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      rowVersion: row.row_version,
      deletedAt: row.deleted_at
    }
  }
}
