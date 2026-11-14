import type Database from 'better-sqlite3'
import {
  hashCanonical,
  newId,
  type CharacterBriefVersion,
  type CreateCharacterBriefVersionInput
} from '@agent2live/contracts'
import { AppError } from '../errors'
import type { EventStore } from '../events/store'
import type { AuditService } from './audit'
import type { Clock } from './clock'
import { withEvents, type EventBuffer } from './events-buffer'
import type { RequestIds } from './request-ids'

interface BriefRow {
  id: string
  character_id: string
  parent_version_id: string | null
  schema_version: 'character-brief/1'
  content_json: string
  content_hash: string
  source_kind: 'user' | 'imported' | 'derived_confirmed'
  created_at: number
}

interface CharacterBriefDeps {
  db: Database.Database
  clock: Clock
  events: EventStore
  audit: AuditService
}

function toDto(row: BriefRow): CharacterBriefVersion {
  return {
    id: row.id,
    characterId: row.character_id,
    parentVersionId: row.parent_version_id,
    schemaVersion: row.schema_version,
    content: JSON.parse(row.content_json),
    contentHash: row.content_hash,
    sourceKind: row.source_kind,
    createdAt: row.created_at
  }
}

export class CharacterBriefService {
  constructor(private readonly deps: CharacterBriefDeps) {}

  get(id: string): CharacterBriefVersion {
    const row = this.deps.db.prepare('select * from character_brief_versions where id = ?').get(id) as
      | BriefRow
      | undefined
    if (!row) throw new AppError('CHARACTER_BRIEF_NOT_FOUND', {})
    return toDto(row)
  }

  list(characterId: string): {
    characterId: string
    activeVersionId: string | null
    items: CharacterBriefVersion[]
  } {
    const character = this.deps.db
      .prepare('select active_brief_version_id from characters where id = ? and deleted_at is null')
      .get(characterId) as { active_brief_version_id: string | null } | undefined
    if (!character) throw new AppError('RESOURCE_NOT_FOUND', { resource: 'character' })
    const rows = this.deps.db
      .prepare(
        'select * from character_brief_versions where character_id = ? order by created_at desc, id desc'
      )
      .all(characterId) as BriefRow[]
    return {
      characterId,
      activeVersionId: character.active_brief_version_id,
      items: rows.map(toDto)
    }
  }

  create(
    characterId: string,
    input: CreateCharacterBriefVersionInput,
    ids: RequestIds
  ): CharacterBriefVersion {
    return withEvents(this.deps.db, this.deps.events, (events) =>
      this.createWithEvents(characterId, input, ids, events)
    )
  }

  createWithEvents(
    characterId: string,
    input: CreateCharacterBriefVersionInput,
    ids: RequestIds,
    events: EventBuffer
  ): CharacterBriefVersion {
    const character = this.deps.db
      .prepare('select active_brief_version_id from characters where id = ? and deleted_at is null')
      .get(characterId) as { active_brief_version_id: string | null } | undefined
    if (!character) throw new AppError('RESOURCE_NOT_FOUND', { resource: 'character' })

    const activeVersionId = character.active_brief_version_id
    if (
      input.expectedActiveBriefVersionId !== undefined &&
      input.expectedActiveBriefVersionId !== activeVersionId
    ) {
      throw new AppError('CHARACTER_BRIEF_STALE', {
        expected: input.expectedActiveBriefVersionId,
        actual: activeVersionId
      })
    }
    const parentVersionId = input.parentVersionId === undefined ? activeVersionId : input.parentVersionId
    if (parentVersionId !== null) {
      const parent = this.deps.db
        .prepare('select character_id from character_brief_versions where id = ?')
        .get(parentVersionId) as { character_id: string } | undefined
      if (!parent || parent.character_id !== characterId) {
        throw new AppError('CHARACTER_BRIEF_NOT_FOUND', { versionId: parentVersionId })
      }
    }

    const id = newId('characterBrief')
    const now = this.deps.clock.now()
    const contentJson = JSON.stringify(input.content)
    const contentHash = hashCanonical(input.content)
    this.deps.db
      .prepare(
        `insert into character_brief_versions
         (id, character_id, parent_version_id, schema_version, content_json, content_hash, source_kind, created_at)
         values (?, ?, ?, 'character-brief/1', ?, ?, ?, ?)`
      )
      .run(id, characterId, parentVersionId, contentJson, contentHash, input.sourceKind, now)
    this.deps.db
      .prepare(
        `update characters set active_brief_version_id = ?, updated_at = ?, row_version = row_version + 1
         where id = ? and deleted_at is null`
      )
      .run(id, now, characterId)

    this.deps.audit.append({
      actor: { kind: 'local-user' },
      action: 'character.brief.created',
      targetType: 'character_brief_version',
      targetId: id,
      outcome: 'success',
      requestId: ids.requestId,
      traceId: ids.traceId,
      ...(activeVersionId === null ? {} : { beforeHash: this.get(activeVersionId).contentHash }),
      afterHash: contentHash,
      metadata: { characterId, parentVersionId }
    })
    events.append({
      type: 'character.brief.created',
      scopeKind: 'character',
      scopeId: characterId,
      payload: { characterId, briefVersionId: id, contentHash },
      requestId: ids.requestId,
      traceId: ids.traceId
    })
    return this.get(id)
  }
}
