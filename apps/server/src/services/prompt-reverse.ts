import type Database from 'better-sqlite3'
import {
  hashCanonical,
  newId,
  promptSpecSchema,
  providerCapabilitiesSchema,
  type PromptReverseResultDto,
  type PromptReverseResultStatus,
  type PromptSpecV2
} from '@agent2live/contracts'
import { AppError } from '../errors'
import { withEvents } from './events-buffer'
import type { EventStore } from '../events/store'
import type { Clock } from './clock'
import type { JobHandlerContext } from '../jobs/types'
import type { PromptReversePayload } from '../jobs/prompt-reverse'
import {
  buildReverseMessages,
  buildReverseState,
  parseReverseOutput,
  reverseContentHash
} from '../prompt/reverse'
import { assertBriefProjection } from '../prompt/brief-projection'
import { normalizeLegacyFullPrompt } from '../prompt/full-prompt'
import type { AuditService } from './audit'
import type { AssetService } from './assets'
import type { CharacterBriefService } from './character-briefs'
import { type PromptDraftDto, type PromptDraftService } from './prompt-drafts'
import type { PromptSubmissionRepository } from './prompt-submissions'
import type { ProviderConnectionService } from './provider-connections'
import type { ProviderInvocationService } from './provider-invocations'
import type { ProviderRegistry } from './provider-registry'
import type { RequestIds } from './request-ids'
import { providerFailureAppError, providerFailureDetail } from './provider-diagnostics'

export type { PromptReverseResultDto, PromptReverseResultStatus }

interface PromptReverseResultRow {
  id: string
  job_id: string
  art_project_id: string
  input_submission_id: string
  base_draft_id: string
  base_draft_revision: number
  base_draft_row_version: number
  base_content_hash: string
  state_json: string
  content_hash: string
  status: PromptReverseResultStatus
  provider_invocation_id: string
  created_at: number
  applied_at: number | null
}

export interface PromptReverseDeps {
  db: Database.Database
  clock: Clock
  drafts: PromptDraftService
  submissions: PromptSubmissionRepository
  briefs: CharacterBriefService
  assets: AssetService
  connections: ProviderConnectionService
  registry: ProviderRegistry
  invocations: ProviderInvocationService
  audit: AuditService
  events: EventStore
}

function storedState(raw: string): PromptSpecV2 {
  try {
    return normalizeLegacyFullPrompt(promptSpecSchema.parse(JSON.parse(raw)))
  } catch {
    throw new AppError('SYS_INTERNAL', {})
  }
}

export class PromptReverseService {
  constructor(private readonly deps: PromptReverseDeps) {}

  prepare(
    projectId: string,
    input: { providerConnectionId: string; inputSubmissionId?: string | undefined },
    _key: string
  ): {
    payload: PromptReversePayload
    base: { revision: number; rowVersion: number }
  } {
    const draft = this.deps.drafts.getActiveRow(projectId)
    if (!draft) throw new AppError('PROMPT_DRAFT_REQUIRED', { artProjectId: projectId })
    if (!draft.input_submission_id) throw new AppError('PROMPT_INPUT_REQUIRED', { artProjectId: projectId })
    if (input.inputSubmissionId && input.inputSubmissionId !== draft.input_submission_id) {
      throw new AppError('PROMPT_INPUT_REQUIRED', { artProjectId: projectId })
    }
    const state = storedState(draft.state_json)
    if (state.lockAll) throw new AppError('PROMPT_BLOCK_LOCKED', { blockId: '*' })
    const submission = this.deps.submissions.get(projectId, draft.input_submission_id)
    const connection = this.deps.connections.getRow(input.providerConnectionId)
    if (!connection.enabled) {
      throw new AppError('PROVIDER_NOT_CONFIGURED', { connectionId: connection.id })
    }
    const capabilities = providerCapabilitiesSchema.parse(JSON.parse(connection.capabilities_json))
    if (connection.kind !== 'chat' || !capabilities.chat) {
      throw new AppError('PROVIDER_CAPABILITY_UNSUPPORTED', { capability: 'chat' })
    }
    return {
      payload: {
        artProjectId: projectId,
        inputSubmissionId: draft.input_submission_id,
        characterBriefVersionId: submission.characterBriefVersionId,
        baseDraftId: draft.id,
        baseDraftRevision: draft.revision,
        baseDraftRowVersion: draft.row_version,
        baseContentHash: draft.content_hash,
        providerConnectionId: connection.id,
        mockProtocol: connection.adapter === 'mock'
      },
      base: { revision: draft.revision, rowVersion: draft.row_version }
    }
  }

  async run(context: JobHandlerContext<PromptReversePayload>): Promise<{ reverseResultId: string }> {
    const payload = context.payload
    const existing = this.deps.db
      .prepare('select id from prompt_reverse_results where job_id = ?')
      .get(context.jobId) as { id: string } | undefined
    if (existing) return { reverseResultId: existing.id }

    const draft = this.deps.drafts.getRow(payload.artProjectId, payload.baseDraftId)
    if (
      draft.status !== 'active' ||
      draft.revision !== payload.baseDraftRevision ||
      draft.content_hash !== payload.baseContentHash
    ) {
      throw new AppError('PROMPT_REVERSE_STALE', {
        baseDraftRowVersion: payload.baseDraftRowVersion,
        currentDraftRowVersion: draft.status === 'active' ? draft.row_version : null
      })
    }
    const base = storedState(draft.state_json)
    const submission = this.deps.submissions.get(payload.artProjectId, payload.inputSubmissionId)
    if (submission.characterBriefVersionId !== payload.characterBriefVersionId) {
      throw new AppError('PROMPT_REVERSE_STALE', {
        baseDraftRowVersion: payload.baseDraftRowVersion,
        currentDraftRowVersion: draft.row_version
      })
    }
    const brief = submission.characterBriefVersionId
      ? this.deps.briefs.get(submission.characterBriefVersionId)
      : null
    const connection = this.deps.connections.getRow(payload.providerConnectionId)
    const capabilities = providerCapabilitiesSchema.parse(JSON.parse(connection.capabilities_json))
    if (!connection.enabled || connection.kind !== 'chat' || !capabilities.chat) {
      throw new AppError('PROVIDER_CAPABILITY_UNSUPPORTED', { capability: 'chat' })
    }
    if (submission.materials.length > 0 && !capabilities.chat.supportsVision) {
      throw new AppError('PROVIDER_CAPABILITY_UNSUPPORTED', { capability: 'vision' })
    }
    const images = submission.materials.slice(0, capabilities.chat.maxImages).map((material) => {
      const { asset, bytes } = this.deps.assets.openContent(material.assetId)
      return { mimeType: asset.mediaType, data: bytes }
    })
    const { messages, warnings } = buildReverseMessages({
      base,
      submission,
      brief,
      images,
      mockProtocol: payload.mockProtocol,
      maxPromptChars: capabilities.chat.maxPromptChars
    })
    const provider = await this.deps.registry.chat(connection.id)
    const requestHash = hashCanonical({
      purpose: 'prompt.reverse',
      artProjectId: payload.artProjectId,
      submissionId: payload.inputSubmissionId,
      baseContentHash: payload.baseContentHash,
      providerConnectionId: payload.providerConnectionId,
      schema: 'prompt-reverse/1'
    })
    const startedAt = this.deps.clock.now()
    const invocationId = this.deps.invocations.start({
      connectionId: connection.id,
      purpose: 'prompt.reverse',
      requestHash,
      model: connection.model
    })
    context.progress(10, 'calling provider')
    let outputText: string
    try {
      const result = await provider.generate(
        { messages, maxTokens: 12_000, responseFormat: 'json' },
        { requestId: context.jobId, signal: context.signal, timeoutMs: 180_000 }
      )
      outputText = result.text
      this.deps.invocations.succeed(invocationId, {
        latencyMs: this.deps.clock.now() - startedAt,
        inputUnits: result.usage?.inputTokens ?? null,
        outputUnits: result.usage?.outputTokens ?? null
      })
    } catch (error) {
      this.deps.invocations.fail(
        invocationId,
        (error as { code?: string }).code ?? 'SYS_INTERNAL',
        this.deps.clock.now() - startedAt,
        providerFailureDetail(error)
      )
      throw providerFailureAppError(error) ?? error
    }
    const output = parseReverseOutput(outputText)
    context.progress(70, 'validating output')
    const state = buildReverseState(base, submission, output, brief)
    const contentHash = reverseContentHash(state)
    const id = newId('promptReverse')
    const now = this.deps.clock.now()
    withEvents(this.deps.db, this.deps.events, (events) => {
      this.deps.db
        .prepare(
          `insert into prompt_reverse_results
           (id, job_id, art_project_id, input_submission_id, base_draft_id, base_draft_revision, base_draft_row_version,
            base_content_hash, state_json, content_hash, status, provider_invocation_id, created_at)
           values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?)`
        )
        .run(
          id,
          context.jobId,
          payload.artProjectId,
          payload.inputSubmissionId,
          payload.baseDraftId,
          payload.baseDraftRevision,
          payload.baseDraftRowVersion,
          payload.baseContentHash,
          JSON.stringify(state),
          contentHash,
          invocationId,
          now
        )
      this.deps.audit.append({
        actor: { kind: 'local-user' },
        action: 'prompt.reverse.ready',
        targetType: 'prompt_reverse_result',
        targetId: id,
        outcome: 'success',
        requestId: context.jobId,
        traceId: context.jobId,
        metadata: {
          contentHash,
          providerInvocationId: invocationId,
          warnings: warnings.length + output.warnings.length
        }
      })
      events.append({
        type: 'prompt.reverse.ready',
        scopeKind: 'project',
        scopeId: payload.artProjectId,
        payload: { reverseResultId: id, contentHash }
      })
    })
    context.progress(100, 'ready')
    return { reverseResultId: id }
  }

  apply(
    resultId: string,
    expectedRowVersion: number,
    ids: RequestIds
  ): { result: PromptReverseResultDto; draft: PromptDraftDto } {
    return withEvents(this.deps.db, this.deps.events, (events) => {
      const resultRow = this.requireRow(resultId)
      if (resultRow.status !== 'ready') {
        throw new AppError('PROMPT_REVERSE_RESOLVED', { status: resultRow.status })
      }
      const draft = this.deps.drafts.getActiveRow(resultRow.art_project_id)
      if (!draft) {
        throw new AppError('PROMPT_REVERSE_STALE', {
          baseDraftRowVersion: resultRow.base_draft_row_version,
          currentDraftRowVersion: null
        })
      }
      if (draft.id !== resultRow.base_draft_id || draft.content_hash !== resultRow.base_content_hash) {
        throw new AppError('PROMPT_REVERSE_STALE', {
          baseDraftRowVersion: resultRow.base_draft_row_version,
          currentDraftRowVersion: draft.row_version
        })
      }
      if (draft.row_version !== expectedRowVersion) {
        throw new AppError('ROW_VERSION_CONFLICT', {
          expected: expectedRowVersion,
          actual: draft.row_version
        })
      }
      const state = storedState(resultRow.state_json)
      const submission = this.deps.submissions.get(resultRow.art_project_id, resultRow.input_submission_id)
      const brief = submission.characterBriefVersionId
        ? this.deps.briefs.get(submission.characterBriefVersionId)
        : null
      if (brief) {
        assertBriefProjection(state, brief.content)
      } else if (state.blocks.some((block) => block.source === 'character-brief')) {
        throw new AppError('PROMPT_BRIEF_PROJECTION_STALE', {})
      }
      const contentHash = reverseContentHash(state)
      if (contentHash !== resultRow.content_hash) throw new AppError('SYS_INTERNAL', {})
      const now = this.deps.clock.now()
      const updated = this.deps.db
        .prepare(
          `update prompt_drafts set state_json = ?, content_hash = ?, revision = revision + 1,
           updated_at = ?, row_version = row_version + 1
           where id = ? and row_version = ? and status = 'active'`
        )
        .run(JSON.stringify(state), contentHash, now, draft.id, expectedRowVersion)
      if (updated.changes !== 1) {
        throw new AppError('ROW_VERSION_CONFLICT', {
          expected: expectedRowVersion,
          actual: draft.row_version
        })
      }
      const resolved = this.deps.db
        .prepare(
          `update prompt_reverse_results set status = 'applied', applied_at = ? where id = ? and status = 'ready'`
        )
        .run(now, resultId)
      if (resolved.changes !== 1) throw new AppError('PROMPT_REVERSE_RESOLVED', { status: 'applied' })
      this.deps.audit.append({
        actor: { kind: 'local-user' },
        action: 'prompt.reverse.applied',
        targetType: 'prompt_reverse_result',
        targetId: resultId,
        outcome: 'success',
        requestId: ids.requestId,
        traceId: ids.traceId,
        metadata: { contentHash }
      })
      events.append({
        type: 'prompt.reverse.applied',
        scopeKind: 'project',
        scopeId: resultRow.art_project_id,
        payload: { reverseResultId: resultId, contentHash }
      })
      return { result: this.get(resultId), draft: this.deps.drafts.requireDraft(draft.id) }
    })
  }

  discard(resultId: string, ids: RequestIds): PromptReverseResultDto {
    return withEvents(this.deps.db, this.deps.events, (events) => {
      const row = this.requireRow(resultId)
      if (row.status === 'discarded') return this.get(resultId)
      if (row.status === 'applied') throw new AppError('PROMPT_REVERSE_RESOLVED', { status: 'applied' })
      const changed = this.deps.db
        .prepare(`update prompt_reverse_results set status = 'discarded' where id = ? and status = 'ready'`)
        .run(resultId)
      if (changed.changes !== 1) throw new AppError('PROMPT_REVERSE_RESOLVED', { status: 'applied' })
      this.deps.audit.append({
        actor: { kind: 'local-user' },
        action: 'prompt.reverse.discarded',
        targetType: 'prompt_reverse_result',
        targetId: resultId,
        outcome: 'success',
        requestId: ids.requestId,
        traceId: ids.traceId,
        metadata: {}
      })
      events.append({
        type: 'prompt.reverse.discarded',
        scopeKind: 'project',
        scopeId: row.art_project_id,
        payload: { reverseResultId: resultId }
      })
      return this.get(resultId)
    })
  }

  get(resultId: string): PromptReverseResultDto {
    return this.toDto(this.requireRow(resultId), true)
  }

  list(
    projectId: string,
    query: { status?: PromptReverseResultStatus | undefined; limit: number }
  ): { items: PromptReverseResultDto[] } {
    const rows = query.status
      ? (this.deps.db
          .prepare(
            `select * from prompt_reverse_results where art_project_id = ? and status = ?
             order by created_at desc, id desc limit ?`
          )
          .all(projectId, query.status, query.limit) as PromptReverseResultRow[])
      : (this.deps.db
          .prepare(
            `select * from prompt_reverse_results where art_project_id = ?
             order by created_at desc, id desc limit ?`
          )
          .all(projectId, query.limit) as PromptReverseResultRow[])
    return { items: rows.map((row) => this.toDto(row, false)) }
  }

  private requireRow(resultId: string): PromptReverseResultRow {
    const row = this.deps.db.prepare('select * from prompt_reverse_results where id = ?').get(resultId) as
      | PromptReverseResultRow
      | undefined
    if (!row) throw new AppError('RESOURCE_NOT_FOUND', { resource: 'promptReverseResult' })
    return row
  }

  private toDto(row: PromptReverseResultRow, includeState: boolean): PromptReverseResultDto {
    return {
      id: row.id,
      jobId: row.job_id,
      artProjectId: row.art_project_id,
      inputSubmissionId: row.input_submission_id,
      baseDraftId: row.base_draft_id,
      baseDraftRevision: row.base_draft_revision,
      baseDraftRowVersion: row.base_draft_row_version,
      baseContentHash: row.base_content_hash,
      state: includeState ? storedState(row.state_json) : null,
      contentHash: row.content_hash,
      status: row.status,
      createdAt: row.created_at
    }
  }
}
