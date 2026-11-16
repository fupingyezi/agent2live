import type Database from 'better-sqlite3'
import { hashCanonical, newId, type CharacterDto, type CreateCharacterInput } from '@agent2live/contracts'
import { AppError } from '../errors'
import type { EventStore } from '../events/store'
import type { AuditService } from './audit'
import type { Clock } from './clock'
import { withEvents } from './events-buffer'
import type { RequestIds } from './request-ids'

export type { CharacterDto }

interface CharacterRow {
  id: string
  title: string
  summary: string | null
  active_brief_version_id: string | null
  created_at: number
  updated_at: number
  deleted_at: number | null
  row_version: number
}

export interface CharacterDeps {
  db: Database.Database
  clock: Clock
  events: EventStore
  audit: AuditService
}

export interface CharacterPatch {
  title?: string | undefined
  summary?: string | null | undefined
}

function toCharacterDto(row: CharacterRow): CharacterDto {
  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    activeBriefVersionId: row.active_brief_version_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    rowVersion: row.row_version
  }
}

export class CharacterService {
  constructor(private readonly deps: CharacterDeps) {}

  list(): { items: CharacterDto[] } {
    const rows = this.deps.db
      .prepare('select * from characters where deleted_at is null order by created_at desc, id desc')
      .all() as CharacterRow[]
    return { items: rows.map(toCharacterDto) }
  }

  get(id: string): CharacterDto {
    const row = this.deps.db.prepare('select * from characters where id = ?').get(id) as
      | CharacterRow
      | undefined
    if (!row) throw new AppError('RESOURCE_NOT_FOUND', { resource: 'character' })
    if (row.deleted_at !== null) throw new AppError('RESOURCE_DELETED', { resource: 'character' })
    return toCharacterDto(row)
  }

  create(input: CreateCharacterInput, ids: RequestIds): CharacterDto {
    return withEvents(this.deps.db, this.deps.events, (events) => {
      const id = newId('character')
      const now = this.deps.clock.now()
      this.deps.db
        .prepare(
          `insert into characters (id, title, summary, created_at, updated_at, row_version)
           values (?, ?, ?, ?, ?, 1)`
        )
        .run(id, input.title, input.summary ?? null, now, now)
      this.deps.audit.append({
        actor: { kind: 'local-user' },
        action: 'character.created',
        targetType: 'character',
        targetId: id,
        outcome: 'success',
        requestId: ids.requestId,
        traceId: ids.traceId,
        metadata: {}
      })
      events.append({
        type: 'character.created',
        scopeKind: 'character',
        scopeId: id,
        payload: { characterId: id },
        requestId: ids.requestId,
        traceId: ids.traceId
      })
      return this.get(id)
    })
  }

  update(id: string, patch: CharacterPatch, expectedRowVersion: number, ids: RequestIds): CharacterDto {
    return withEvents(this.deps.db, this.deps.events, (events) => {
      const current = this.get(id)
      const updated = this.deps.db
        .prepare(
          `update characters set title = ?, summary = ?, updated_at = ?, row_version = row_version + 1
           where id = ? and row_version = ? and deleted_at is null`
        )
        .run(
          patch.title ?? current.title,
          patch.summary === undefined ? current.summary : patch.summary,
          this.deps.clock.now(),
          id,
          expectedRowVersion
        )
      if (updated.changes !== 1) throw new AppError('ROW_VERSION_CONFLICT', { expected: expectedRowVersion })
      const after = this.get(id)
      this.deps.audit.append({
        actor: { kind: 'local-user' },
        action: 'character.updated',
        targetType: 'character',
        targetId: id,
        outcome: 'success',
        requestId: ids.requestId,
        traceId: ids.traceId,
        beforeHash: hashCanonical({ title: current.title, summary: current.summary }),
        afterHash: hashCanonical({ title: after.title, summary: after.summary }),
        metadata: {}
      })
      events.append({
        type: 'character.updated',
        scopeKind: 'character',
        scopeId: id,
        payload: { characterId: id, rowVersion: after.rowVersion },
        requestId: ids.requestId,
        traceId: ids.traceId
      })
      return after
    })
  }

  softDelete(id: string, expectedRowVersion: number, ids: RequestIds): void {
    withEvents(this.deps.db, this.deps.events, (events) => {
      this.get(id)
      const now = this.deps.clock.now()
      const updated = this.deps.db
        .prepare(
          `update characters set deleted_at = ?, updated_at = ?, row_version = row_version + 1
           where id = ? and row_version = ? and deleted_at is null`
        )
        .run(now, now, id, expectedRowVersion)
      if (updated.changes !== 1) throw new AppError('ROW_VERSION_CONFLICT', { expected: expectedRowVersion })
      const projects = this.deps.db
        .prepare('select id from art_projects where character_id = ? and deleted_at is null order by id asc')
        .all(id) as Array<{ id: string }>
      for (const project of projects) {
        this.deps.db
          .prepare(
            `update art_projects set deleted_at = ?, updated_at = ?, row_version = row_version + 1
             where id = ? and deleted_at is null`
          )
          .run(now, now, project.id)
        this.deps.audit.append({
          actor: { kind: 'local-user' },
          action: 'project.deleted',
          targetType: 'art_project',
          targetId: project.id,
          outcome: 'success',
          requestId: ids.requestId,
          traceId: ids.traceId,
          metadata: { cascadedFromCharacterId: id }
        })
        events.append({
          type: 'project.deleted',
          scopeKind: 'project',
          scopeId: project.id,
          payload: { projectId: project.id },
          requestId: ids.requestId,
          traceId: ids.traceId
        })
      }
      this.deps.audit.append({
        actor: { kind: 'local-user' },
        action: 'character.deleted',
        targetType: 'character',
        targetId: id,
        outcome: 'success',
        requestId: ids.requestId,
        traceId: ids.traceId,
        metadata: {}
      })
      events.append({
        type: 'character.deleted',
        scopeKind: 'character',
        scopeId: id,
        payload: { characterId: id },
        requestId: ids.requestId,
        traceId: ids.traceId
      })
    })
  }
}
