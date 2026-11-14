import type Database from 'better-sqlite3'
import { materialRoleSchema, promptRequirementSchema, type PromptRequirement } from '@agent2live/contracts'
import { z } from 'zod'
import { AppError } from '../errors'

export interface PromptInputMaterialDto {
  id: string
  assetId: string
  role: z.infer<typeof materialRoleSchema>
  note: string
  weight: number
  locked: boolean
  sortOrder: number
}

export interface PromptInputSubmissionDto {
  id: string
  artProjectId: string
  draftId: string
  revision: number
  characterBriefVersionId: string | null
  globalNotes: string
  requirements: PromptRequirement[]
  materials: PromptInputMaterialDto[]
}

interface SubmissionRow {
  id: string
  art_project_id: string
  draft_id: string
  revision: number
  character_brief_version_id: string | null
  global_notes: string | null
  requirements_json: string
}

interface AssetLinkRow {
  id: string
  asset_id: string
  role: string
  note: string | null
  weight: number
  sort_order: number
  locked: number
}

export class PromptSubmissionRepository {
  constructor(private readonly db: Database.Database) {}

  get(projectId: string, id: string): PromptInputSubmissionDto {
    const row = this.db
      .prepare('select * from prompt_input_submissions where id = ? and art_project_id = ?')
      .get(id, projectId) as SubmissionRow | undefined
    if (!row) throw new AppError('RESOURCE_NOT_FOUND', { resource: 'promptInputSubmission' })
    return this.toDto(row)
  }

  latest(projectId: string): PromptInputSubmissionDto | null {
    const row = this.db
      .prepare(
        'select * from prompt_input_submissions where art_project_id = ? order by revision desc limit 1'
      )
      .get(projectId) as SubmissionRow | undefined
    return row ? this.toDto(row) : null
  }

  requirements(projectId: string, id: string): PromptRequirement[] {
    return this.get(projectId, id).requirements
  }

  materials(projectId: string, id: string): PromptInputMaterialDto[] {
    return this.get(projectId, id).materials
  }

  private toDto(row: SubmissionRow): PromptInputSubmissionDto {
    const links = this.db
      .prepare(
        `select id, asset_id, role, note, weight, sort_order, locked
         from asset_links where owner_type = 'prompt_input' and owner_id = ?
         order by sort_order asc, id asc`
      )
      .all(row.id) as AssetLinkRow[]
    const requirements = z.array(promptRequirementSchema).parse(JSON.parse(row.requirements_json))
    return {
      id: row.id,
      artProjectId: row.art_project_id,
      draftId: row.draft_id,
      revision: row.revision,
      characterBriefVersionId: row.character_brief_version_id,
      globalNotes: row.global_notes ?? '',
      requirements,
      materials: links.map((link) => ({
        id: link.id,
        assetId: link.asset_id,
        role: materialRoleSchema.parse(link.role),
        note: link.note ?? '',
        weight: link.weight,
        locked: link.locked === 1,
        sortOrder: link.sort_order
      }))
    }
  }
}
