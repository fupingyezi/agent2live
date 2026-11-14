import type Database from 'better-sqlite3'
import type { ForkLinkDto, ProjectForkSlice } from '@agent2live/contracts'

export type { ForkLinkDto }

export interface ForkLinkRow {
  id: string
  child_project_id: string
  parent_project_id: string
  root_project_id: string
  source_kind: 'prompt_version' | 'art_version'
  source_version_id: string
  source_hash: string
  branch_label: string
  status: 'active' | 'detached'
  created_at: number
  detached_at: number | null
}

export function loadForkLinkRow(db: Database.Database, childProjectId: string): ForkLinkRow | null {
  return (
    (db.prepare('select * from project_forks where child_project_id = ?').get(childProjectId) as
      | ForkLinkRow
      | undefined) ?? null
  )
}

export function toForkLinkDto(row: ForkLinkRow): ForkLinkDto {
  return {
    id: row.id,
    childProjectId: row.child_project_id,
    parentProjectId: row.parent_project_id,
    rootProjectId: row.root_project_id,
    sourceKind: row.source_kind,
    sourceVersionId: row.source_version_id,
    sourceHash: row.source_hash,
    branchLabel: row.branch_label,
    status: row.status,
    createdAt: row.created_at,
    detachedAt: row.detached_at
  }
}

export function projectForkSlice(db: Database.Database, projectId: string): ProjectForkSlice | null {
  const row = loadForkLinkRow(db, projectId)
  if (!row) return null
  const parent = db.prepare('select deleted_at from art_projects where id = ?').get(row.parent_project_id) as
    | { deleted_at: number | null }
    | undefined
  return {
    forkId: row.id,
    parentProjectId: row.parent_project_id,
    rootProjectId: row.root_project_id,
    sourceKind: row.source_kind,
    sourceVersionId: row.source_version_id,
    branchLabel: row.branch_label,
    status: row.status,
    parentDeleted: parent?.deleted_at !== null && parent?.deleted_at !== undefined
  }
}
