import type Database from 'better-sqlite3'
import { artVersionReferenceSetSchema, type ArtVersionReference } from '@agent2live/contracts'
import { AppError } from '../errors'

export interface ArtVersionReferenceDto extends ArtVersionReference {
  id: string
}

export interface ArtVersionDto {
  id: string
  artProjectId: string
  versionNumber: number
  parentVersionId: string | null
  originVersionId: string | null
  promptVersionId: string
  references: ArtVersionReferenceDto[]
  source: Record<string, unknown>
  validation: Record<string, unknown>
  canvasTransform: Record<string, unknown>
  contentHash: string
  createdAt: number
}

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

export class ArtVersionService {
  constructor(private readonly db: Database.Database) {}

  private readReferences(versionId: string): AssetLinkRow[] {
    return this.db
      .prepare(
        `select id, asset_id, role, note, weight, sort_order, is_primary, locked
         from asset_links
         where owner_type = 'art_version' and owner_id = ?
         order by sort_order, id`
      )
      .all(versionId) as AssetLinkRow[]
  }

  active(projectId: string): ArtVersionDto | null {
    const row = this.db
      .prepare(
        `select v.* from art_versions v
         join art_projects p on p.active_version_id = v.id and v.art_project_id = p.id
         where p.id = ? and p.deleted_at is null`
      )
      .get(projectId) as ArtVersionRow | undefined
    return row ? toArtVersionDto(row, this.readReferences(row.id)) : null
  }

  get(projectId: string, versionId: string): ArtVersionDto {
    const row = this.db
      .prepare('select * from art_versions where id = ? and art_project_id = ?')
      .get(versionId, projectId) as ArtVersionRow | undefined
    if (!row) throw new AppError('RESOURCE_NOT_FOUND', { resource: 'artVersion' })
    return toArtVersionDto(row, this.readReferences(row.id))
  }
}
