import type Database from 'better-sqlite3'
import {
  newId,
  promptReferenceSetSchema,
  promptSpecSchema,
  type PromptMaterialRef,
  type PromptReference,
  type PromptSpecV2,
  type PromptVersionDto,
  type PromptVersionSummary
} from '@agent2live/contracts'
import { AppError } from '../errors'
import { normalizeLegacyFullPrompt } from '../prompt/full-prompt'

export type { PromptVersionDto, PromptVersionSummary }

interface VersionRow {
  id: string
  art_project_id: string
  version_number: number
  parent_version_id: string | null
  input_submission_id: string
  content_json: string
  content_hash: string
  created_at: number
}

interface PromptReferenceRow {
  asset_id: string
  role: string
  note: string | null
  weight: number
  locked: number
}

export function readPromptReferences(db: Database.Database, promptVersionId: string): PromptReference[] {
  const rows = db
    .prepare(
      `select asset_id, role, note, weight, locked
       from asset_links
       where owner_type = 'prompt_version' and owner_id = ?
       order by sort_order, id`
    )
    .all(promptVersionId) as PromptReferenceRow[]
  const parsed = promptReferenceSetSchema.safeParse(
    rows.map((row) => ({
      assetId: row.asset_id,
      role: row.role,
      note: row.note ?? '',
      weight: row.weight,
      locked: row.locked === 1
    }))
  )
  if (!parsed.success) {
    throw new AppError('SYS_INTERNAL', { reason: 'prompt references are invalid' })
  }
  return parsed.data
}

export function promptReferencesFromMaterialRefs(materialRefs: PromptMaterialRef[]): PromptReference[] {
  return materialRefs.map((material) => ({
    assetId: material.assetId,
    role: material.role,
    note: material.note,
    weight: material.weight,
    locked: material.locked
  }))
}

export function writePromptReferences(
  db: Database.Database,
  promptVersionId: string,
  references: PromptReference[],
  createdAt: number
): void {
  const parsed = promptReferenceSetSchema.safeParse(references)
  if (!parsed.success) {
    throw new AppError('PROMPT_REFERENCE_SET_INVALID', {
      reasons: parsed.error.issues.slice(0, 20).map((issue) => issue.message)
    })
  }
  const insert = db.prepare(
    `insert into asset_links
     (id, asset_id, owner_type, owner_id, role, note, weight, sort_order, locked, created_at)
     values (?, ?, 'prompt_version', ?, ?, ?, ?, ?, ?, ?)`
  )
  parsed.data.forEach((reference, sortOrder) => {
    insert.run(
      newId('assetLink'),
      reference.assetId,
      promptVersionId,
      reference.role,
      reference.note,
      reference.weight,
      sortOrder,
      reference.locked ? 1 : 0,
      createdAt
    )
  })
}

export function toVersionDto(row: VersionRow, references: PromptReference[]): PromptVersionDto {
  const stored = normalizeLegacyFullPrompt(promptSpecSchema.parse(JSON.parse(row.content_json)))
  const state = promptSpecSchema.parse({
    ...stored,
    materialRefs: references.map((reference) => ({
      assetId: reference.assetId,
      role: reference.role,
      note: reference.note,
      weight: reference.weight,
      locked: reference.locked
    }))
  })
  return {
    id: row.id,
    artProjectId: row.art_project_id,
    versionNumber: row.version_number,
    parentVersionId: row.parent_version_id,
    inputSubmissionId: row.input_submission_id,
    characterBriefVersionId: state.characterBriefVersionId ?? null,
    state,
    references,
    contentHash: row.content_hash,
    createdAt: row.created_at
  }
}

export class PromptVersionService {
  constructor(private readonly db: Database.Database) {}

  list(projectId: string): { items: PromptVersionSummary[] } {
    const rows = this.db
      .prepare(
        'select id, version_number, parent_version_id, content_hash, created_at from prompt_versions where art_project_id = ? order by version_number desc'
      )
      .all(projectId) as Array<
      Pick<VersionRow, 'id' | 'version_number' | 'parent_version_id' | 'content_hash' | 'created_at'>
    >
    return {
      items: rows.map((row) => ({
        id: row.id,
        versionNumber: row.version_number,
        parentVersionId: row.parent_version_id,
        contentHash: row.content_hash,
        createdAt: row.created_at
      }))
    }
  }

  get(projectId: string, versionId: string): PromptVersionDto {
    const row = this.db
      .prepare('select * from prompt_versions where id = ? and art_project_id = ?')
      .get(versionId, projectId) as VersionRow | undefined
    if (!row) throw new AppError('RESOURCE_NOT_FOUND', { resource: 'promptVersion' })
    return toVersionDto(row, readPromptReferences(this.db, row.id))
  }

  requireById(versionId: string): PromptVersionDto {
    const row = this.db.prepare('select * from prompt_versions where id = ?').get(versionId) as
      | VersionRow
      | undefined
    if (!row) throw new AppError('RESOURCE_NOT_FOUND', { resource: 'promptVersion' })
    return toVersionDto(row, readPromptReferences(this.db, row.id))
  }
}
