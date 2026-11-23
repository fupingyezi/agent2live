import type Database from 'better-sqlite3'
import { z } from 'zod'
import {
  createDraftInputSchema,
  newId,
  promptSpecSchema,
  type CharacterBriefVersion,
  type PromptDraftDto,
  type PromptSpecV2,
  type PromptWorkspaceDto
} from '@agent2live/contracts'
import { AppError } from '../errors'
import { withEvents } from './events-buffer'
import type { EventStore } from '../events/store'
import type { Clock } from './clock'
import { normalizeText } from '../prompt/normalize'
import { normalizeLegacyFullPrompt } from '../prompt/full-prompt'
import { assertBriefProjection, mergeBriefProjection } from '../prompt/brief-projection'
import { specContentHash } from '../prompt/compile'
import type { AuditService } from './audit'
import type { CharacterBriefService } from './character-briefs'
import type { ArtProjectDto, ProjectService } from './projects'
import {
  promptReferencesFromMaterialRefs,
  writePromptReferences,
  type PromptVersionDto,
  type PromptVersionService
} from './prompt-versions'
import type { PromptInputSubmissionDto, PromptSubmissionRepository } from './prompt-submissions'
import type { RequestIds } from './request-ids'

export type { PromptDraftDto, PromptWorkspaceDto }

export interface PromptDraftRow {
  id: string
  art_project_id: string
  revision: number
  status: 'active' | 'committed' | 'superseded'
  state_json: string
  content_hash: string
  input_submission_id: string | null
  base_version_id: string | null
  created_at: number
  updated_at: number
  row_version: number
}

export interface PromptDraftDeps {
  db: Database.Database
  clock: Clock
  events: EventStore
  audit: AuditService
  projects: ProjectService
  briefs: CharacterBriefService
  versions: PromptVersionService
  submissions: PromptSubmissionRepository
}

export const EMPTY_STATE: PromptSpecV2 = {
  schemaVersion: 'prompt-spec/2',
  fullPrompt: '',
  lockAll: false,
  sourceRequirements: [],
  materialRefs: [],
  blocks: [],
  negativeBlocks: [],
  constraints: { canvas: { width: 1024, height: 1792 }, background: 'transparent', aspect: 'portrait' }
}

export function toDraftDto(row: PromptDraftRow): PromptDraftDto {
  return {
    id: row.id,
    artProjectId: row.art_project_id,
    revision: row.revision,
    status: row.status,
    state: normalizeLegacyFullPrompt(promptSpecSchema.parse(JSON.parse(row.state_json))),
    contentHash: row.content_hash,
    inputSubmissionId: row.input_submission_id,
    baseVersionId: row.base_version_id,
    rowVersion: row.row_version,
    updatedAt: row.updated_at
  }
}

export function normalizeSpecForSubmission(
  state: PromptSpecV2,
  submission: PromptInputSubmissionDto,
  brief: CharacterBriefVersion | null = null,
  options: { adoptGlobalNotes?: boolean; replaceMaterialsFromSubmission?: boolean } = {}
): PromptSpecV2 {
  let next: PromptSpecV2 = {
    ...structuredClone(state),
    characterBriefVersionId: submission.characterBriefVersionId,
    sourceRequirements: submission.requirements,
    materialRefs:
      options.replaceMaterialsFromSubmission === true
        ? submission.materials.map((material) => ({
            assetId: material.assetId,
            role: material.role,
            note: material.note,
            weight: material.weight,
            locked: material.locked
          }))
        : structuredClone(state.materialRefs)
  }
  for (const block of [...next.blocks, ...next.negativeBlocks]) {
    block.text = normalizeText(block.text)
    block.label = normalizeText(block.label)
  }
  for (const requirement of next.sourceRequirements) requirement.text = normalizeText(requirement.text)
  for (const material of next.materialRefs) material.note = normalizeText(material.note)
  const derivedFullPrompt = normalizeLegacyFullPrompt({ ...state, fullPrompt: '' }).fullPrompt.trim()
  if (
    options.adoptGlobalNotes === true &&
    submission.globalNotes.trim() &&
    (!next.fullPrompt.trim() || next.fullPrompt.trim() === derivedFullPrompt)
  ) {
    next.fullPrompt = normalizeText(submission.globalNotes)
  }
  if (brief) {
    next = mergeBriefProjection(next, brief.content)
  } else if (next.blocks.some((block) => block.source === 'character-brief')) {
    throw new AppError('PROMPT_BRIEF_PROJECTION_STALE', {})
  }
  return normalizeLegacyFullPrompt(promptSpecSchema.parse(next))
}

export function uncoveredRequirements(state: PromptSpecV2): string[] {
  const positiveRefs = new Set(state.blocks.flatMap((block) => block.requirementRefs))
  const negativeRefs = new Set(state.negativeBlocks.flatMap((block) => block.requirementRefs))
  return state.sourceRequirements
    .filter((requirement) =>
      requirement.strength === 'must'
        ? !positiveRefs.has(requirement.id)
        : requirement.strength === 'avoid'
          ? !negativeRefs.has(requirement.id)
          : false
    )
    .map((requirement) => requirement.id)
}

export class PromptDraftService {
  constructor(private readonly deps: PromptDraftDeps) {}

  create(projectId: string, input: z.infer<typeof createDraftInputSchema>, ids: RequestIds): PromptDraftDto {
    this.deps.projects.getWritable(projectId)
    return withEvents(this.deps.db, this.deps.events, (events) => {
      const active = this.getActiveRow(projectId)
      if (active) throw new AppError('PROMPT_DRAFT_EXISTS', { draftId: active.id })
      const project = this.deps.db
        .prepare('select active_prompt_version_id from art_projects where id = ?')
        .get(projectId) as { active_prompt_version_id: string | null }
      let state = structuredClone(EMPTY_STATE)
      let baseVersionId: string | null = null
      let inputSubmissionId: string | null = null
      if (input.from === 'active_version') {
        if (!project.active_prompt_version_id) {
          throw new AppError('PROMPT_VERSION_REQUIRED', { artProjectId: projectId })
        }
        const version = this.deps.versions.get(projectId, project.active_prompt_version_id)
        state = version.state
        baseVersionId = version.id
        inputSubmissionId = version.inputSubmissionId
      } else if (input.from === 'version') {
        const version = this.deps.versions.get(projectId, input.versionId)
        state = version.state
        baseVersionId = version.id
        inputSubmissionId = version.inputSubmissionId
      }
      const now = this.deps.clock.now()
      const id = newId('promptDraft')
      const revision = this.nextDraftRevision(projectId)
      this.deps.db
        .prepare(
          `insert into prompt_drafts
           (id, art_project_id, revision, status, state_json, content_hash, input_submission_id, base_version_id, created_at, updated_at, row_version)
           values (?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, 1)`
        )
        .run(
          id,
          projectId,
          revision,
          JSON.stringify(state),
          specContentHash(state),
          inputSubmissionId,
          baseVersionId,
          now,
          now
        )
      this.deps.db
        .prepare(
          'update art_projects set stage = ?, updated_at = ?, row_version = row_version + 1 where id = ?'
        )
        .run('prompt_draft', now, projectId)
      events.append({
        type: 'prompt.draft.created',
        scopeKind: 'project',
        scopeId: projectId,
        payload: { draftId: id },
        requestId: ids.requestId,
        traceId: ids.traceId
      })
      return this.requireDraft(id)
    })
  }

  save(
    projectId: string,
    draftId: string,
    expectedRowVersion: number,
    incoming: PromptSpecV2,
    ids: RequestIds
  ): PromptDraftDto {
    this.deps.projects.getWritable(projectId)
    return withEvents(this.deps.db, this.deps.events, (events) => {
      const draft = this.requireActiveDraft(projectId, draftId, expectedRowVersion)
      if (!draft.input_submission_id) {
        throw new AppError('PROMPT_INPUT_REQUIRED', { artProjectId: projectId })
      }
      const submission = this.deps.submissions.get(projectId, draft.input_submission_id)
      const brief = this.briefForSubmission(submission)
      const state = normalizeSpecForSubmission(incoming, submission, brief)
      const contentHash = specContentHash(state)
      const now = this.deps.clock.now()
      const changed = this.deps.db
        .prepare(
          `update prompt_drafts set state_json = ?, content_hash = ?, revision = revision + 1,
           updated_at = ?, row_version = row_version + 1
           where id = ? and row_version = ? and status = 'active'`
        )
        .run(JSON.stringify(state), contentHash, now, draftId, expectedRowVersion)
      if (changed.changes !== 1) {
        throw new AppError('ROW_VERSION_CONFLICT', { expected: expectedRowVersion })
      }
      this.deps.audit.append({
        actor: { kind: 'local-user' },
        action: 'prompt.draft.saved',
        targetType: 'prompt_draft',
        targetId: draftId,
        outcome: 'success',
        requestId: ids.requestId,
        traceId: ids.traceId,
        metadata: { contentHash }
      })
      events.append({
        type: 'prompt.draft.saved',
        scopeKind: 'project',
        scopeId: projectId,
        payload: { draftId, revision: draft.revision + 1, contentHash },
        requestId: ids.requestId,
        traceId: ids.traceId
      })
      return this.requireDraft(draftId)
    })
  }

  commit(
    projectId: string,
    draftId: string,
    expectedRowVersion: number,
    acknowledge: boolean,
    ids: RequestIds
  ): { version: PromptVersionDto; artProject: ArtProjectDto } {
    this.deps.projects.getWritable(projectId)
    return withEvents(this.deps.db, this.deps.events, (events) => {
      const draft = this.requireActiveDraft(projectId, draftId, expectedRowVersion)
      if (!draft.input_submission_id) {
        throw new AppError('PROMPT_INPUT_REQUIRED', { artProjectId: projectId })
      }
      const submission = this.deps.submissions.get(projectId, draft.input_submission_id)
      const brief = this.briefForSubmission(submission)
      const state = normalizeLegacyFullPrompt(promptSpecSchema.parse(JSON.parse(draft.state_json)))
      if (brief) {
        assertBriefProjection(state, brief.content)
      } else if (state.blocks.some((block) => block.source === 'character-brief')) {
        throw new AppError('PROMPT_BRIEF_PROJECTION_STALE', {})
      }
      const uncovered = uncoveredRequirements(state)
      if (uncovered.length > 0 && !acknowledge) {
        throw new AppError('PROMPT_REQUIREMENT_UNCOVERED', {
          requirementIds: uncovered.slice(0, 50)
        })
      }
      const project = this.deps.db
        .prepare(
          'select character_id, active_prompt_version_id, row_version from art_projects where id = ? and deleted_at is null'
        )
        .get(projectId) as {
        character_id: string
        active_prompt_version_id: string | null
        row_version: number
      }
      const versionId = newId('promptVersion')
      const versionState: PromptSpecV2 = {
        ...state,
        promptVersionId: versionId,
        artProjectId: projectId,
        parentVersionId: project.active_prompt_version_id,
        inputSubmissionId: submission.id,
        characterBriefVersionId: submission.characterBriefVersionId,
        characterId: project.character_id
      }
      const contentHash = specContentHash(versionState)
      versionState.contentHash = contentHash
      const versionNumber =
        (
          this.deps.db
            .prepare(
              'select coalesce(max(version_number), 0) as n from prompt_versions where art_project_id = ?'
            )
            .get(projectId) as { n: number }
        ).n + 1
      const now = this.deps.clock.now()
      this.deps.db
        .prepare(
          `insert into prompt_versions
           (id, art_project_id, parent_version_id, input_submission_id, content_json, content_hash, version_number, created_at)
           values (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          versionId,
          projectId,
          project.active_prompt_version_id,
          submission.id,
          JSON.stringify(versionState),
          contentHash,
          versionNumber,
          now
        )
      writePromptReferences(
        this.deps.db,
        versionId,
        promptReferencesFromMaterialRefs(versionState.materialRefs),
        now
      )
      this.deps.db
        .prepare(
          `update prompt_drafts set status = 'committed', updated_at = ?, row_version = row_version + 1 where id = ?`
        )
        .run(now, draftId)
      const updated = this.deps.db
        .prepare(
          'update art_projects set active_prompt_version_id = ?, stage = ?, updated_at = ?, row_version = row_version + 1 where id = ? and row_version = ?'
        )
        .run(versionId, 'prompt_ready', now, projectId, project.row_version)
      if (updated.changes !== 1) {
        throw new AppError('ROW_VERSION_CONFLICT', { expected: project.row_version })
      }
      this.deps.audit.append({
        actor: { kind: 'local-user' },
        action: 'prompt.version.committed',
        targetType: 'prompt_version',
        targetId: versionId,
        outcome: 'success',
        requestId: ids.requestId,
        traceId: ids.traceId,
        metadata: { versionNumber, contentHash, uncovered: uncovered.join(',') }
      })
      events.append({
        type: 'prompt.version.committed',
        scopeKind: 'project',
        scopeId: projectId,
        payload: { versionId, versionNumber, contentHash },
        requestId: ids.requestId,
        traceId: ids.traceId
      })
      return {
        version: this.deps.versions.get(projectId, versionId),
        artProject: this.deps.projects.get(projectId)
      }
    })
  }

  getWorkspace(projectId: string): PromptWorkspaceDto {
    const project = this.deps.projects.get(projectId)
    const activeDraft = this.getActiveRow(projectId)
    const activePromptVersion = project.activePromptVersionId
      ? this.deps.versions.get(projectId, project.activePromptVersionId)
      : null
    return {
      artProjectId: projectId,
      activeDraft: activeDraft ? toDraftDto(activeDraft) : null,
      activePromptVersion,
      latestSubmission: this.deps.submissions.latest(projectId),
      versions: this.deps.versions.list(projectId).items
    }
  }

  getActiveRow(projectId: string): PromptDraftRow | null {
    const row = this.deps.db
      .prepare(`select * from prompt_drafts where art_project_id = ? and status = 'active'`)
      .get(projectId) as PromptDraftRow | undefined
    return row ?? null
  }

  getRow(projectId: string, draftId: string): PromptDraftRow {
    const row = this.deps.db
      .prepare('select * from prompt_drafts where id = ? and art_project_id = ?')
      .get(draftId, projectId) as PromptDraftRow | undefined
    if (!row) throw new AppError('RESOURCE_NOT_FOUND', { resource: 'promptDraft' })
    return row
  }

  requireDraft(draftId: string): PromptDraftDto {
    const row = this.deps.db.prepare('select * from prompt_drafts where id = ?').get(draftId) as
      | PromptDraftRow
      | undefined
    if (!row) throw new AppError('RESOURCE_NOT_FOUND', { resource: 'promptDraft' })
    return toDraftDto(row)
  }

  requireActiveDraft(projectId: string, draftId: string, expectedRowVersion: number): PromptDraftRow {
    const row = this.getRow(projectId, draftId)
    if (row.status !== 'active') throw new AppError('PROMPT_DRAFT_REQUIRED', { artProjectId: projectId })
    if (row.row_version !== expectedRowVersion) {
      throw new AppError('ROW_VERSION_CONFLICT', {
        expected: expectedRowVersion,
        actual: row.row_version
      })
    }
    return row
  }

  versionState(projectId: string, versionId: string): PromptSpecV2 {
    return this.deps.versions.get(projectId, versionId).state
  }

  briefForSubmission(submission: PromptInputSubmissionDto): CharacterBriefVersion | null {
    return submission.characterBriefVersionId
      ? this.deps.briefs.get(submission.characterBriefVersionId)
      : null
  }

  insertFromVersion(projectId: string, version: PromptVersionDto, now: number): PromptDraftRow {
    this.deps.projects.getWritable(projectId)
    const active = this.getActiveRow(projectId)
    if (active) throw new AppError('PROMPT_DRAFT_EXISTS', { draftId: active.id })
    const id = newId('promptDraft')
    this.deps.db
      .prepare(
        `insert into prompt_drafts
         (id, art_project_id, revision, status, state_json, content_hash, input_submission_id, base_version_id, created_at, updated_at, row_version)
         values (?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, 1)`
      )
      .run(
        id,
        projectId,
        this.nextDraftRevision(projectId),
        JSON.stringify(version.state),
        specContentHash(version.state),
        version.inputSubmissionId,
        version.id,
        now,
        now
      )
    return this.getRow(projectId, id)
  }

  nextDraftRevision(projectId: string): number {
    return (
      (
        this.deps.db
          .prepare('select coalesce(max(revision), 0) as n from prompt_drafts where art_project_id = ?')
          .get(projectId) as { n: number }
      ).n + 1
    )
  }
}
