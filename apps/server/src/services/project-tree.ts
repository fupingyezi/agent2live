import type Database from 'better-sqlite3'
import type { ArtProjectDto, ProjectService } from './projects'

export interface ProjectTreeDto {
  root: ArtProjectDto
  roots: ArtProjectDto[]
  children: ArtProjectDto[]
  forks: Array<{
    id: string
    childProjectId: string
    parentProjectId: string
    rootProjectId: string
    sourceKind: 'prompt_version' | 'art_version'
    sourceVersionId: string
    branchLabel: string
    status: 'active' | 'detached'
    parentDeleted: boolean
  }>
}

interface ForkTreeRow {
  id: string
  child_project_id: string
  parent_project_id: string
  root_project_id: string
  source_kind: 'prompt_version' | 'art_version'
  source_version_id: string
  branch_label: string
  status: 'active' | 'detached'
  parent_deleted_at: number | null
}

export class ProjectTreeService {
  constructor(private readonly deps: { db: Database.Database; projects: ProjectService }) {}

  get(projectId: string): ProjectTreeDto {
    const ownFork = this.deps.db
      .prepare('select root_project_id from project_forks where child_project_id = ?')
      .get(projectId) as { root_project_id: string } | undefined
    const rootId = ownFork?.root_project_id ?? projectId
    const root = this.deps.projects.get(rootId, { includeDeleted: true })
    const forkRows = this.deps.db
      .prepare(
        `select f.*, p.deleted_at as parent_deleted_at
         from project_forks f join art_projects p on p.id = f.parent_project_id
         where f.root_project_id = ? order by f.created_at asc, f.id asc`
      )
      .all(rootId) as ForkTreeRow[]
    const childIds = [...new Set(forkRows.map((fork) => fork.child_project_id))]
    const children = childIds.map((id) => this.deps.projects.get(id, { includeDeleted: true }))
    return {
      root,
      roots: [root],
      children,
      forks: forkRows.map((fork) => ({
        id: fork.id,
        childProjectId: fork.child_project_id,
        parentProjectId: fork.parent_project_id,
        rootProjectId: fork.root_project_id,
        sourceKind: fork.source_kind,
        sourceVersionId: fork.source_version_id,
        branchLabel: fork.branch_label,
        status: fork.status,
        parentDeleted: fork.parent_deleted_at !== null
      }))
    }
  }
}
