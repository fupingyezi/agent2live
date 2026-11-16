import type Database from 'better-sqlite3'
import {
  newId,
  promptSpecSchema,
  type PromptInputMultipartMetadata,
  type PromptInputResult,
  type PromptSpecV2
} from '@agent2live/contracts'
import { AppError } from '../errors'
import { withEvents } from './events-buffer'
import type { EventStore } from '../events/store'
import type { Clock } from './clock'
import { specContentHash } from '../prompt/compile'
import { normalizeLegacyFullPrompt } from '../prompt/full-prompt'
import type { AuditService } from './audit'
import type { AssetService } from './assets'
import type { CharacterBriefService } from './character-briefs'
import {
  EMPTY_STATE,
  normalizeSpecForSubmission,
  uncoveredRequirements,
  type PromptDraftDto,
  type PromptDraftService
} from './prompt-drafts'
import type { PromptInputMaterialDto, PromptSubmissionRepository } from './prompt-submissions'
import type { ProjectService } from './projects'
import type { RequestIds } from './request-ids'
import type { UploadedPart } from '../routes/multipart'

export type { PromptInputResult }

export interface PromptInputDeps {
  db: Database.Database
  assets: AssetService
  briefs: CharacterBriefService
  drafts: PromptDraftService
  submissions: PromptSubmissionRepository
  projects: ProjectService
  clock: Clock
  events: EventStore
  audit: AuditService
}

type NewMaterial = Omit<PromptInputMaterialDto, 'id'>

export class PromptInputService {
  constructor(private readonly deps: PromptInputDeps) {}

  async ingest(
    projectId: string,
    metadata: PromptInputMultipartMetadata,
    files: Map<string, UploadedPart>,
    expectedDraftRowVersion: number | null,
    ids: RequestIds
  ): Promise<PromptInputResult> {
    this.deps.projects.getWritable(projectId)
    for (const material of metadata.materials) {
      if (material.fileField && !files.has(material.fileField)) {
        throw new AppError('REQUEST_INVALID', { reason: 'missing_file_part' })
      }
    }
    for (const fieldName of files.keys()) {
      if (!metadata.materials.some((material) => material.fileField === fieldName)) {
        throw new AppError('REQUEST_INVALID', { reason: 'unexpected_file_part' })
      }
    }
    const materials: NewMaterial[] = []
    for (const material of metadata.materials) {
      let assetId = material.assetId
      if (material.fileField) {
        const file = files.get(material.fileField)!
        const ingested = await this.deps.assets.ingestUpload({
          bytes: file.bytes,
          declaredMime: file.mimeType,
          originalName: file.filename,
          requestId: ids.requestId,
          traceId: ids.traceId
        })
        assetId = ingested.asset.id
      } else if (assetId) {
        this.deps.assets.getAsset(assetId)
      }
      if (!assetId) throw new AppError('REQUEST_INVALID', { reason: 'material_asset_required' })
      materials.push({
        assetId,
        role: material.role,
        note: material.note,
        weight: material.weight,
        locked: material.locked,
        sortOrder: material.sortOrder
      })
    }

    return withEvents(this.deps.db, this.deps.events, (events) => {
      const existing = this.deps.drafts.getActiveRow(projectId)
      if (existing && expectedDraftRowVersion === null) {
        throw new AppError('PRECONDITION_REQUIRED', { header: 'If-Match' })
      }
      if (existing && existing.row_version !== expectedDraftRowVersion) {
        throw new AppError('ROW_VERSION_CONFLICT', {
          expected: expectedDraftRowVersion,
          actual: existing.row_version
        })
      }
      const now = this.deps.clock.now()
      const project = this.deps.db
        .prepare(
          'select character_id, active_prompt_version_id from art_projects where id = ? and deleted_at is null'
        )
        .get(projectId) as { character_id: string; active_prompt_version_id: string | null } | undefined
      if (!project) throw new AppError('RESOURCE_NOT_FOUND', { resource: 'artProject' })
      const baseState: PromptSpecV2 = existing
        ? normalizeLegacyFullPrompt(promptSpecSchema.parse(JSON.parse(existing.state_json)))
        : project.active_prompt_version_id
          ? this.deps.drafts.versionState(projectId, project.active_prompt_version_id)
          : structuredClone(EMPTY_STATE)
      const activeVersionSubmissionId = project.active_prompt_version_id
        ? ((
            this.deps.db
              .prepare('select input_submission_id from prompt_versions where id = ? and art_project_id = ?')
              .get(project.active_prompt_version_id, projectId) as { input_submission_id: string } | undefined
          )?.input_submission_id ?? null)
        : null
      const inheritedSubmissionId = existing?.input_submission_id ?? activeVersionSubmissionId
      const inheritedBriefVersionId = inheritedSubmissionId
        ? this.deps.submissions.get(projectId, inheritedSubmissionId).characterBriefVersionId
        : null
      const brief = metadata.characterBrief
        ? this.deps.briefs.createWithEvents(
            project.character_id,
            {
              content: metadata.characterBrief,
              sourceKind: 'user'
            },
            ids,
            events
          )
        : metadata.characterBriefVersionId
          ? this.deps.briefs.get(metadata.characterBriefVersionId)
          : inheritedBriefVersionId
            ? this.deps.briefs.get(inheritedBriefVersionId)
            : null
      if (brief && brief.characterId !== project.character_id) {
        throw new AppError('REQUEST_INVALID', { reason: 'character_brief_project_mismatch' })
      }
      const draftId = existing?.id ?? newId('promptDraft')
      const draftRevision = existing ? existing.revision + 1 : this.deps.drafts.nextDraftRevision(projectId)

      if (!existing) {
        this.deps.db
          .prepare(
            `insert into prompt_drafts
             (id, art_project_id, revision, status, state_json, content_hash, input_submission_id, base_version_id, created_at, updated_at, row_version)
             values (?, ?, ?, 'active', ?, ?, NULL, ?, ?, ?, 1)`
          )
          .run(
            draftId,
            projectId,
            draftRevision,
            JSON.stringify(baseState),
            specContentHash(baseState),
            project.active_prompt_version_id,
            now,
            now
          )
      }

      const submissionId = newId('promptInput')
      this.deps.db
        .prepare(
          `insert into prompt_input_submissions
           (id, art_project_id, draft_id, revision, character_brief_version_id, global_notes, requirements_json, created_at, row_version)
           values (?, ?, ?, ?, ?, ?, ?, ?, 1)`
        )
        .run(
          submissionId,
          projectId,
          draftId,
          draftRevision,
          brief?.id ?? null,
          metadata.globalNotes ?? '',
          JSON.stringify(metadata.requirements),
          now
        )
      for (const material of materials) {
        this.deps.db
          .prepare(
            `insert into asset_links
             (id, asset_id, owner_type, owner_id, role, note, weight, sort_order, locked, created_at)
             values (?, ?, 'prompt_input', ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            newId('assetLink'),
            material.assetId,
            submissionId,
            material.role,
            material.note,
            material.weight,
            material.sortOrder,
            material.locked ? 1 : 0,
            now
          )
      }

      const submission = this.deps.submissions.get(projectId, submissionId)
      const knownAssets = new Set(submission.materials.map((material) => material.assetId))
      const knownRequirements = new Set(submission.requirements.map((requirement) => requirement.id))
      const referencedBlocks = [...baseState.blocks, ...baseState.negativeBlocks]
      const missingAssetIds = [
        ...new Set(
          referencedBlocks
            .flatMap((block) => block.materialRefs)
            .filter((assetId) => !knownAssets.has(assetId))
        )
      ]
      const missingRequirementIds = [
        ...new Set(
          referencedBlocks
            .flatMap((block) => block.requirementRefs)
            .filter((requirementId) => !knownRequirements.has(requirementId))
        )
      ]
      if (missingAssetIds.length > 0 || missingRequirementIds.length > 0) {
        throw new AppError('PROMPT_INPUT_MISMATCH', {
          missingAssetIds: missingAssetIds.slice(0, 20),
          missingRequirementIds: missingRequirementIds.slice(0, 50)
        })
      }
      const state = normalizeSpecForSubmission(baseState, submission, brief, {
        adoptGlobalNotes: true
      })
      const contentHash = specContentHash(state)

      if (existing) {
        const updated = this.deps.db
          .prepare(
            `update prompt_drafts
             set state_json = ?, content_hash = ?, input_submission_id = ?, revision = revision + 1,
                 updated_at = ?, row_version = row_version + 1
             where id = ? and row_version = ? and status = 'active'`
          )
          .run(JSON.stringify(state), contentHash, submissionId, now, draftId, expectedDraftRowVersion)
        if (updated.changes !== 1) {
          throw new AppError('ROW_VERSION_CONFLICT', { expected: expectedDraftRowVersion })
        }
      } else {
        this.deps.db
          .prepare(
            `update prompt_drafts set state_json = ?, content_hash = ?, input_submission_id = ?, updated_at = ?
             where id = ?`
          )
          .run(JSON.stringify(state), contentHash, submissionId, now, draftId)
      }
      this.deps.db
        .prepare(
          'update art_projects set stage = ?, updated_at = ?, row_version = row_version + 1 where id = ?'
        )
        .run('prompt_draft', now, projectId)

      const warnings = uncoveredRequirements(state)
      this.deps.audit.append({
        actor: { kind: 'local-user' },
        action: 'prompt.input.ingested',
        targetType: 'prompt_input_submission',
        targetId: submissionId,
        outcome: 'success',
        requestId: ids.requestId,
        traceId: ids.traceId,
        metadata: { revision: draftRevision }
      })
      events.append({
        type: 'prompt.input.created',
        scopeKind: 'project',
        scopeId: projectId,
        payload: { submissionId, revision: draftRevision, draftId, requirementWarnings: warnings },
        requestId: ids.requestId,
        traceId: ids.traceId
      })
      return {
        submission,
        draft: this.deps.drafts.requireDraft(draftId),
        warnings
      }
    })
  }
}
