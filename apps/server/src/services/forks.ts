import type Database from 'better-sqlite3'
import {
  hashCanonical,
  newId,
  promptSpecSchema,
  type CharacterLineageDto,
  type CreateForkInput,
  type ForkLinkMutationDto,
  type ForkResultDto,
  type LineageNodeDto,
  type PatchForkInput,
  type PromptReference
} from '@agent2live/contracts'
import { AppError } from '../errors'
import { specContentHash } from '../prompt/compile'
import { normalizeLegacyFullPrompt } from '../prompt/full-prompt'
import { withEvents } from './events-buffer'
import { parseObject, type ArtVersionService } from './art-versions'
import type { AssetService } from './assets'
import type { AuditService } from './audit'
import type { Clock } from './clock'
import type { EventStore } from '../events/store'
import { loadForkLinkRow, toForkLinkDto, type ForkLinkRow } from './fork-query'
import type { ProjectService } from './projects'
import { readPromptReferences, writePromptReferences, type PromptVersionService } from './prompt-versions'
import type { RequestIds } from './request-ids'

export interface ForkServiceDeps {
  db: Database.Database
  clock: Clock
  projects: ProjectService
  promptVersions: PromptVersionService
  artVersions: ArtVersionService
  assets: AssetService
  audit: AuditService
  events: EventStore
}

export type { CharacterLineageDto, ForkLinkMutationDto, ForkResultDto, LineageNodeDto }

interface SourceProjectRow {
  id: string
  character_id: string
  deleted_at: number | null
}
interface SourcePromptVersionRow {
  id: string
  art_project_id: string
  parent_version_id: string | null
  parent_project_version_id: string | null
  origin_version_id: string | null
  input_submission_id: string
  content_json: string
  content_hash: string
  version_number: number
  created_at: number
}
interface SourceArtVersionRow {
  id: string
  art_project_id: string
  parent_version_id: string | null
  origin_version_id: string | null
  prompt_version_id: string
  artwork_asset_id: string
  generation_job_id: string | null
  source_kind: 'generated' | 'manual_upload' | 'fork_seed'
  source_json: string
  validation_json: string
  canvas_transform_json: string
  content_hash: string
  version_number: number
  created_at: number
}
interface SourceSubmissionRow {
  id: string
  art_project_id: string
  draft_id: string
  revision: number
  character_brief_version_id: string | null
  global_notes: string | null
  requirements_json: string
  created_at: number
  row_version: number
}
interface SourceAssetLinkRow {
  id: string
  asset_id: string
  owner_type: string
  owner_id: string
  role: string
  note: string | null
  weight: number
  sort_order: number
  locked: number
  created_at: number
}
interface LineageProjectRow {
  id: string
  character_id: string
  deleted_at: number | null
  created_at: number
}

interface ForkSource {
  projectId: string
  sourceHash: string
  prompt: SourcePromptVersionRow
  promptRefs: PromptReference[]
  sourceSubmission: SourceSubmissionRow
  sourceLinks: SourceAssetLinkRow[]
  art: SourceArtVersionRow | null
}

function isBranchUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE' &&
    String((error as { message?: string }).message).includes('ux_forks_branch_active')
  )
}

export class ForkService {
  constructor(private readonly deps: ForkServiceDeps) {}

  createFromPromptVersion(versionId: string, input: CreateForkInput, ctx: RequestIds): ForkResultDto {
    return this.createFromSource({
      sourceKind: 'prompt_version',
      sourceVersionId: versionId,
      forkInput: input,
      ctx
    })
  }

  createFromArtVersion(versionId: string, input: CreateForkInput, ctx: RequestIds): ForkResultDto {
    return this.createFromSource({
      sourceKind: 'art_version',
      sourceVersionId: versionId,
      forkInput: input,
      ctx
    })
  }

  updateLink(projectId: string, input: PatchForkInput, ctx: RequestIds): ForkLinkMutationDto {
    return withEvents(this.deps.db, this.deps.events, (events) => {
      this.deps.projects.getWritable(projectId)
      const row = loadForkLinkRow(this.deps.db, projectId)
      if (!row) throw new AppError('RESOURCE_NOT_FOUND', { resource: 'projectFork' })
      const now = this.deps.clock.now()
      let branchLabel = row.branch_label
      if (input.branchLabel !== undefined) {
        branchLabel = input.branchLabel.trim()
        if (row.status === 'active' && branchLabel.toLowerCase() !== row.branch_label.toLowerCase()) {
          const conflict = this.deps.db
            .prepare(
              `select 1 from project_forks
             where parent_project_id = ? and lower(branch_label) = lower(?) and status = 'active'
               and id <> ?`
            )
            .get(row.parent_project_id, branchLabel, row.id)
          if (conflict) {
            throw new AppError('FORK_BRANCH_CONFLICT', {
              parentProjectId: row.parent_project_id,
              branchLabel
            })
          }
        }
        try {
          this.deps.db
            .prepare('update project_forks set branch_label = ? where id = ?')
            .run(branchLabel, row.id)
        } catch (error) {
          if (isBranchUniqueViolation(error)) {
            throw new AppError('FORK_BRANCH_CONFLICT', {
              parentProjectId: row.parent_project_id,
              branchLabel
            })
          }
          throw error
        }
      }
      const detach = input.detach === true && row.status === 'active'
      if (detach) {
        this.deps.db
          .prepare(
            `update project_forks set status = 'detached', detached_at = ? where id = ? and status = 'active'`
          )
          .run(now, row.id)
      }
      this.deps.audit.append({
        actor: { kind: 'local-user' },
        action: detach ? 'art_project.fork_detached' : 'art_project.fork_updated',
        targetType: 'project_fork',
        targetId: row.id,
        outcome: 'success',
        requestId: ctx.requestId,
        traceId: ctx.traceId,
        metadata: { branchLabelHash: hashCanonical(branchLabel), detached: detach }
      })
      events.append({
        type: detach ? 'artProject.forkDetached' : 'artProject.forkUpdated',
        scopeKind: 'project',
        scopeId: projectId,
        payload: { forkId: row.id, childProjectId: projectId, status: detach ? 'detached' : undefined },
        requestId: ctx.requestId,
        traceId: ctx.traceId
      })
      const updated = loadForkLinkRow(this.deps.db, projectId)
      if (!updated) throw new AppError('SYS_INTERNAL', { reason: 'fork row missing' })
      return {
        fork: toForkLinkDto(updated),
        childProject: this.deps.projects.get(projectId)
      }
    })
  }

  lineage(characterId: string): CharacterLineageDto {
    const rows = this.deps.db
      .prepare(
        'select id, character_id, deleted_at, created_at from art_projects where character_id = ? order by created_at, id'
      )
      .all(characterId) as LineageProjectRow[]
    if (rows.length === 0) throw new AppError('RESOURCE_NOT_FOUND', { resource: 'character' })
    const forks = this.deps.db
      .prepare(
        `select f.* from project_forks f
       join art_projects p on p.id = f.child_project_id
       where p.character_id = ?`
      )
      .all(characterId) as ForkLinkRow[]
    const rowById = new Map(rows.map((row) => [row.id, row]))
    const forkByChild = new Map(forks.map((fork) => [fork.child_project_id, fork]))
    const activeChildren = new Map<string, string[]>()
    for (const fork of forks) {
      if (fork.status !== 'active') continue
      const list = activeChildren.get(fork.parent_project_id) ?? []
      list.push(fork.child_project_id)
      activeChildren.set(fork.parent_project_id, list)
    }

    const keep = new Set(rows.filter((row) => row.deleted_at === null).map((row) => row.id))
    for (const id of [...keep]) {
      let cursor: string | undefined = id
      const seen = new Set<string>()
      while (cursor) {
        if (seen.has(cursor)) throw new AppError('SYS_INTERNAL', { reason: 'fork cycle' })
        seen.add(cursor)
        const fork = forkByChild.get(cursor)
        if (!fork || fork.status !== 'active') break
        keep.add(fork.parent_project_id)
        cursor = fork.parent_project_id
      }
    }
    for (const id of keep) {
      if (!rowById.has(id)) throw new AppError('SYS_INTERNAL', { reason: 'fork target missing' })
    }

    const build = (id: string, stack: Set<string>): LineageNodeDto => {
      if (stack.has(id)) throw new AppError('SYS_INTERNAL', { reason: 'fork cycle' })
      if (!rowById.has(id)) throw new AppError('SYS_INTERNAL', { reason: 'fork target missing' })
      const nextStack = new Set(stack)
      nextStack.add(id)
      const forkRow = forkByChild.get(id) ?? null
      const parent = forkRow ? rowById.get(forkRow.parent_project_id) : undefined
      const project = this.deps.projects.get(id, { includeDeleted: true })
      return {
        project,
        fork: forkRow ? toForkLinkDto(forkRow) : null,
        parentDeleted: parent?.deleted_at !== null && parent?.deleted_at !== undefined,
        children: (activeChildren.get(id) ?? [])
          .filter((childId) => keep.has(childId))
          .sort((left, right) => {
            const a = rowById.get(left)!
            const b = rowById.get(right)!
            return a.created_at - b.created_at || a.id.localeCompare(b.id)
          })
          .map((childId) => build(childId, nextStack))
      }
    }

    const roots = rows
      .filter((row) => keep.has(row.id))
      .filter((row) => {
        const fork = forkByChild.get(row.id)
        return !fork || fork.status !== 'active'
      })
      .sort((left, right) => left.created_at - right.created_at || left.id.localeCompare(right.id))
      .map((row) => build(row.id, new Set()))

    return { characterId, roots }
  }

  private createFromSource(input: {
    sourceKind: 'prompt_version' | 'art_version'
    sourceVersionId: string
    forkInput: CreateForkInput
    ctx: RequestIds
  }): ForkResultDto {
    return withEvents(this.deps.db, this.deps.events, (events) => {
      const source =
        input.sourceKind === 'prompt_version'
          ? this.loadPromptSource(input.sourceVersionId)
          : this.loadArtSource(input.sourceVersionId)
      const project = this.deps.db
        .prepare('select id, character_id, deleted_at from art_projects where id = ?')
        .get(source.projectId) as SourceProjectRow | undefined
      if (!project) throw new AppError('RESOURCE_NOT_FOUND', { resource: 'artProject' })
      if (project.deleted_at !== null) throw new AppError('RESOURCE_DELETED', { resource: 'artProject' })
      this.deps.projects.getWritable(source.projectId)

      const branchLabel = input.forkInput.branchLabel.trim()
      const existing = this.deps.db
        .prepare(
          `select 1 from project_forks
         where parent_project_id = ? and lower(branch_label) = lower(?) and status = 'active'`
        )
        .get(source.projectId, branchLabel)
      if (existing) {
        throw new AppError('FORK_BRANCH_CONFLICT', {
          parentProjectId: source.projectId,
          branchLabel
        })
      }
      const prior = this.deps.db
        .prepare('select root_project_id from project_forks where child_project_id = ?')
        .get(source.projectId) as { root_project_id: string } | undefined
      const rootProjectId = prior?.root_project_id ?? source.projectId

      const now = this.deps.clock.now()
      const forkId = newId('projectFork')
      const childId = newId('artProject')
      this.deps.db
        .prepare(
          `insert into art_projects
         (id, character_id, title, description, stage, active_version_id, active_prompt_version_id,
          created_at, updated_at, deleted_at, row_version)
         values (?, ?, ?, ?, 'idea_draft', null, null, ?, ?, null, 1)`
        )
        .run(
          childId,
          project.character_id,
          input.forkInput.title.trim(),
          input.forkInput.description?.trim() || null,
          now,
          now
        )

      const seedPrompt = this.clonePromptSeed(source, childId, forkId, now)
      let seedArtVersionId: string | null = null
      if (source.art) {
        const art = source.art
        const seedArt = this.deps.artVersions.insertSeededVersion({
          projectId: childId,
          promptVersionId: seedPrompt.id,
          originVersionId: art.origin_version_id ?? art.id,
          artworkAssetId: art.artwork_asset_id,
          source: {
            schemaVersion: 'art-source/1',
            kind: 'fork_seed',
            sourceArtVersionId: art.id,
            sourceProjectId: art.art_project_id,
            forkId
          },
          validation: parseObject(art.validation_json, 'validation_json'),
          canvasTransform: parseObject(art.canvas_transform_json, 'canvas_transform_json'),
          ctx: input.ctx
        })
        seedArtVersionId = seedArt.id
      }

      this.deps.db
        .prepare(
          `update art_projects
         set stage = ?, active_prompt_version_id = ?, active_version_id = ?,
             updated_at = ?, row_version = row_version + 1
         where id = ?`
        )
        .run(
          source.art ? 'art_version_active' : 'prompt_ready',
          seedPrompt.id,
          seedArtVersionId,
          now,
          childId
        )

      try {
        this.deps.db
          .prepare(
            `insert into project_forks
           (id, child_project_id, parent_project_id, root_project_id, source_kind,
            source_version_id, source_hash, branch_label, status, created_at, detached_at)
           values (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, null)`
          )
          .run(
            forkId,
            childId,
            source.projectId,
            rootProjectId,
            input.sourceKind,
            input.sourceVersionId,
            source.sourceHash,
            branchLabel,
            now
          )
      } catch (error) {
        if (isBranchUniqueViolation(error)) {
          throw new AppError('FORK_BRANCH_CONFLICT', {
            parentProjectId: source.projectId,
            branchLabel
          })
        }
        throw error
      }

      this.deps.audit.append({
        actor: { kind: 'local-user' },
        action: 'art_project.forked',
        targetType: 'art_project',
        targetId: childId,
        outcome: 'success',
        requestId: input.ctx.requestId,
        traceId: input.ctx.traceId,
        metadata: {
          forkId,
          parentProjectId: source.projectId,
          rootProjectId,
          sourceIsArt: input.sourceKind === 'art_version',
          sourceVersionId: input.sourceVersionId,
          branchLabelHash: hashCanonical(branchLabel),
          seedVersionId: seedPrompt.id,
          seedArtVersionId
        }
      })
      events.append({
        type: 'artProject.forked',
        scopeKind: 'character',
        scopeId: project.character_id,
        payload: {
          forkId,
          childProjectId: childId,
          parentProjectId: source.projectId,
          sourceKind: input.sourceKind,
          sourceVersionId: input.sourceVersionId,
          seedPromptVersionId: seedPrompt.id,
          seedArtVersionId
        },
        requestId: input.ctx.requestId,
        traceId: input.ctx.traceId
      })
      const forkRow = loadForkLinkRow(this.deps.db, childId)
      if (!forkRow) throw new AppError('SYS_INTERNAL', { reason: 'fork row missing' })
      return {
        fork: toForkLinkDto(forkRow),
        childProject: this.deps.projects.get(childId),
        seedPromptVersion: this.deps.promptVersions.get(childId, seedPrompt.id),
        seedArtVersion: seedArtVersionId ? this.deps.artVersions.get(childId, seedArtVersionId) : null
      }
    })
  }

  private loadPromptSource(versionId: string): ForkSource {
    const prompt = this.deps.db.prepare('select * from prompt_versions where id = ?').get(versionId) as
      | SourcePromptVersionRow
      | undefined
    if (!prompt) throw new AppError('RESOURCE_NOT_FOUND', { resource: 'promptVersion' })
    const parsed = normalizeLegacyFullPrompt(promptSpecSchema.parse(JSON.parse(prompt.content_json)))
    if (specContentHash(parsed) !== prompt.content_hash) {
      throw new AppError('FORK_SOURCE_UNCOMMITTED', {})
    }
    const submission = this.deps.db
      .prepare('select * from prompt_input_submissions where id = ?')
      .get(prompt.input_submission_id) as SourceSubmissionRow | undefined
    if (!submission) throw new AppError('SYS_INTERNAL', { reason: 'prompt input missing' })
    const links = this.deps.db
      .prepare(
        `select * from asset_links where owner_type = 'prompt_input' and owner_id = ? order by sort_order, id`
      )
      .all(submission.id) as SourceAssetLinkRow[]
    return {
      projectId: prompt.art_project_id,
      sourceHash: prompt.content_hash,
      prompt,
      promptRefs: readPromptReferences(this.deps.db, prompt.id),
      sourceSubmission: submission,
      sourceLinks: links,
      art: null
    }
  }

  private loadArtSource(versionId: string): ForkSource {
    const art = this.deps.db.prepare('select * from art_versions where id = ?').get(versionId) as
      | SourceArtVersionRow
      | undefined
    if (!art) throw new AppError('RESOURCE_NOT_FOUND', { resource: 'artVersion' })
    this.deps.assets.getAsset(art.artwork_asset_id)
    const promptRow = this.deps.db
      .prepare('select * from prompt_versions where id = ? and art_project_id = ?')
      .get(art.prompt_version_id, art.art_project_id) as SourcePromptVersionRow | undefined
    if (!promptRow) throw new AppError('SYS_INTERNAL', { reason: 'art prompt version missing' })
    const parsed = normalizeLegacyFullPrompt(promptSpecSchema.parse(JSON.parse(promptRow.content_json)))
    if (specContentHash(parsed) !== promptRow.content_hash) {
      throw new AppError('FORK_SOURCE_UNCOMMITTED', {})
    }
    const submission = this.deps.db
      .prepare('select * from prompt_input_submissions where id = ?')
      .get(promptRow.input_submission_id) as SourceSubmissionRow | undefined
    if (!submission) throw new AppError('SYS_INTERNAL', { reason: 'prompt input missing' })
    const links = this.deps.db
      .prepare(
        `select * from asset_links where owner_type = 'prompt_input' and owner_id = ? order by sort_order, id`
      )
      .all(submission.id) as SourceAssetLinkRow[]
    return {
      projectId: art.art_project_id,
      sourceHash: art.content_hash,
      prompt: promptRow,
      promptRefs: readPromptReferences(this.deps.db, promptRow.id),
      sourceSubmission: submission,
      sourceLinks: links,
      art
    }
  }

  private clonePromptSeed(
    source: ForkSource,
    childProjectId: string,
    forkId: string,
    now: number
  ): { id: string } {
    const draftId = newId('promptDraft')
    const submissionId = newId('promptInput')
    const seedVersionId = newId('promptVersion')

    this.deps.db
      .prepare(
        `insert into prompt_drafts
       (id, art_project_id, revision, status, state_json, content_hash, input_submission_id,
        base_version_id, created_at, updated_at, row_version)
       values (?, ?, 1, 'committed', ?, ?, null, null, ?, ?, 1)`
      )
      .run(draftId, childProjectId, source.prompt.content_json, source.prompt.content_hash, now, now)
    this.deps.db
      .prepare(
        `insert into prompt_input_submissions
       (id, art_project_id, draft_id, revision, character_brief_version_id,
        global_notes, requirements_json, created_at, row_version)
       values (?, ?, ?, 1, ?, ?, ?, ?, 1)`
      )
      .run(
        submissionId,
        childProjectId,
        draftId,
        source.sourceSubmission.character_brief_version_id,
        source.sourceSubmission.global_notes,
        source.sourceSubmission.requirements_json,
        now
      )
    this.deps.db
      .prepare('update prompt_drafts set input_submission_id = ? where id = ?')
      .run(submissionId, draftId)
    for (const link of source.sourceLinks) {
      this.deps.db
        .prepare(
          `insert into asset_links
         (id, asset_id, owner_type, owner_id, role, note, weight, sort_order, locked, created_at)
         values (?, ?, 'prompt_input', ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          newId('assetLink'),
          link.asset_id,
          submissionId,
          link.role,
          link.note,
          link.weight,
          link.sort_order,
          link.locked,
          now
        )
    }
    this.deps.db
      .prepare(
        `insert into prompt_versions
       (id, art_project_id, parent_version_id, parent_project_version_id, origin_version_id,
        input_submission_id, content_json, content_hash, version_number, created_at)
       values (?, ?, null, ?, ?, ?, ?, ?, 1, ?)`
      )
      .run(
        seedVersionId,
        childProjectId,
        source.prompt.id,
        source.prompt.origin_version_id ?? source.prompt.id,
        submissionId,
        source.prompt.content_json,
        source.prompt.content_hash,
        now
      )
    writePromptReferences(this.deps.db, seedVersionId, source.promptRefs, now)
    return { id: seedVersionId }
  }
}
