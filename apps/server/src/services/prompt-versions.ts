import type Database from 'better-sqlite3'
import { promptSpecSchema, type PromptSpecV2 } from '@agent2live/contracts'
import { AppError } from '../errors'

export interface PromptVersionDto {
  id: string
  artProjectId: string
  versionNumber: number
  parentVersionId: string | null
  inputSubmissionId: string
  characterBriefVersionId: string | null
  state: PromptSpecV2
  contentHash: string
  createdAt: number
}

export interface PromptVersionSummary {
  id: string
  versionNumber: number
  parentVersionId: string | null
  contentHash: string
  createdAt: number
}

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

export function toVersionDto(row: VersionRow): PromptVersionDto {
  const state = promptSpecSchema.parse(JSON.parse(row.content_json))
  return {
    id: row.id,
    artProjectId: row.art_project_id,
    versionNumber: row.version_number,
    parentVersionId: row.parent_version_id,
    inputSubmissionId: row.input_submission_id,
    characterBriefVersionId: state.characterBriefVersionId ?? null,
    state,
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
    return toVersionDto(row)
  }
}
