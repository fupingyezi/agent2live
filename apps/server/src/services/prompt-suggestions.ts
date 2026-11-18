import type Database from 'better-sqlite3'
import {
  getErrorDefinition,
  hashCanonical,
  newId,
  promptSpecSchema,
  promptSuggestionOutputSchema,
  providerCapabilitiesSchema,
  type CharacterBriefVersion,
  type PromptSpecV2,
  type PromptSuggestionDto,
  type PromptSuggestionOutput,
  type PromptSuggestionStatus
} from '@agent2live/contracts'
import { AppError } from '../errors'
import { withEvents } from './events-buffer'
import type { EventStore } from '../events/store'
import type { Clock } from './clock'
import type { JobHandlerContext } from '../jobs/types'
import type { PromptSuggestionPayload } from '../jobs/prompt-suggestion'
import type { AuditService } from './audit'
import type { CharacterBriefService } from './character-briefs'
import type { ProjectService } from './projects'
import { normalizeSpecForSubmission, type PromptDraftDto, type PromptDraftService } from './prompt-drafts'
import type { PromptVersionDto, PromptVersionService } from './prompt-versions'
import type { PromptSubmissionRepository } from './prompt-submissions'
import type { ProviderConnectionRow, ProviderConnectionService } from './provider-connections'
import type { ProviderInvocationService } from './provider-invocations'
import type { ProviderRegistry } from './provider-registry'
import type { RequestIds } from './request-ids'
import { specContentHash } from '../prompt/compile'
import { normalizeLegacyFullPrompt } from '../prompt/full-prompt'
import { applyPromptOperations } from '../prompt/apply-operations'
import { buildSuggestionPrompt, parseSuggestionOutput, validateSuggestionOutput } from '../prompt/suggestion'
import { providerFailureAppError, providerFailureDetail } from './provider-diagnostics'

export interface PromptSuggestionInput {
  providerConnectionId: string
  intent: string
}

export type { PromptSuggestionDto, PromptSuggestionStatus }

interface PromptSuggestionRow {
  id: string
  job_id: string
  art_project_id: string
  base_kind: 'prompt_version' | 'prompt_draft'
  base_version_id: string | null
  base_draft_id: string | null
  base_draft_revision: number | null
  base_draft_row_version: number | null
  base_content_hash: string
  operations_json: string
  warnings_json: string
  intent: string
  status: PromptSuggestionStatus
  accepted_draft_id: string | null
  accepted_draft_revision: number | null
  created_at: number
  resolved_at: number | null
}

export interface PromptSuggestionDeps {
  db: Database.Database
  clock: Clock
  projects: ProjectService
  versions: PromptVersionService
  drafts: PromptDraftService
  submissions: PromptSubmissionRepository
  briefs: CharacterBriefService
  connections: ProviderConnectionService
  registry: ProviderRegistry
  invocations: ProviderInvocationService
  audit: AuditService
  events: EventStore
}

/** Provider failures must never spill raw messages into persisted rows. */
function invocationErrorCode(error: unknown): string {
  const candidate = (error as { code?: unknown }).code
  if (
    typeof candidate === 'string' &&
    candidate.length <= 80 &&
    getErrorDefinition(candidate).code === candidate
  ) {
    return candidate
  }
  return 'SYS_INTERNAL'
}

function baseLabel(kind: PromptSuggestionRow['base_kind']): 'draft' | 'version' {
  return kind === 'prompt_version' ? 'version' : 'draft'
}

export class PromptSuggestionService {
  constructor(private readonly deps: PromptSuggestionDeps) {}

  prepareFromVersion(versionId: string, input: PromptSuggestionInput): PromptSuggestionPayload {
    const version = this.requireVersion(versionId)
    this.deps.projects.getWritable(version.artProjectId)
    if (version.state.lockAll) throw new AppError('PROMPT_BLOCK_LOCKED', { blockId: '*' })
    const submission = this.deps.submissions.get(version.artProjectId, version.inputSubmissionId)
    const connection = this.requireChatConnection(input.providerConnectionId)
    return {
      baseKind: 'prompt_version',
      baseVersionId: version.id,
      artProjectId: version.artProjectId,
      providerConnectionId: connection.id,
      characterBriefVersionId: submission.characterBriefVersionId,
      intent: input.intent,
      baseContentHash: version.contentHash,
      mockProtocol: connection.adapter === 'mock'
    }
  }

  prepareFromDraft(
    projectId: string,
    draftId: string,
    input: PromptSuggestionInput
  ): PromptSuggestionPayload {
    this.deps.projects.getWritable(projectId)
    const draft = this.deps.drafts.getRow(projectId, draftId)
    if (draft.status !== 'active') {
      throw new AppError('PROMPT_DRAFT_REQUIRED', { artProjectId: projectId })
    }
    if (!draft.input_submission_id) {
      throw new AppError('PROMPT_INPUT_REQUIRED', { artProjectId: projectId })
    }
    const submission = this.deps.submissions.get(projectId, draft.input_submission_id)
    const state = this.parseStoredState(draft.state_json)
    if (state.lockAll) throw new AppError('PROMPT_BLOCK_LOCKED', { blockId: '*' })
    const connection = this.requireChatConnection(input.providerConnectionId)
    return {
      baseKind: 'prompt_draft',
      baseDraftId: draft.id,
      baseDraftRevision: draft.revision,
      baseDraftRowVersion: draft.row_version,
      artProjectId: projectId,
      providerConnectionId: connection.id,
      characterBriefVersionId: submission.characterBriefVersionId,
      intent: input.intent,
      baseContentHash: draft.content_hash,
      mockProtocol: connection.adapter === 'mock'
    }
  }

  async run(context: JobHandlerContext<PromptSuggestionPayload>): Promise<{ suggestionId: string }> {
    const existing = this.deps.db
      .prepare('select id from prompt_suggestions where job_id = ?')
      .get(context.jobId) as { id: string } | undefined
    if (existing) return { suggestionId: existing.id }

    const payload = context.payload
    const base = this.loadFreshBase(payload)
    const brief = this.loadPinnedBrief(payload)
    const connection = this.requireChatConnection(payload.providerConnectionId)
    const capabilities = providerCapabilitiesSchema.parse(JSON.parse(connection.capabilities_json))
    const prompt = buildSuggestionPrompt(
      base,
      brief,
      payload.intent,
      payload.mockProtocol,
      capabilities.chat!.maxPromptChars
    )
    const provider = await this.deps.registry.chat(connection.id)
    const startedAt = this.deps.clock.now()
    const invocationId = this.deps.invocations.start({
      connectionId: connection.id,
      purpose: 'prompt.suggestion',
      requestHash: hashCanonical({
        purpose: 'prompt.suggestion',
        baseHash: payload.baseContentHash,
        intent: payload.intent,
        connectionId: connection.id,
        schema: 'prompt-suggestion/1'
      }),
      model: connection.model
    })
    context.progress(20, 'calling provider')
    let responseText: string
    try {
      const response = await provider.generate(
        { messages: prompt.messages, maxTokens: 4000 },
        { requestId: context.jobId, signal: context.signal, timeoutMs: 60_000 }
      )
      responseText = response.text
      this.deps.invocations.succeed(invocationId, {
        latencyMs: this.deps.clock.now() - startedAt,
        inputUnits: response.usage?.inputTokens ?? null,
        outputUnits: response.usage?.outputTokens ?? null
      })
    } catch (error) {
      this.deps.invocations.fail(
        invocationId,
        invocationErrorCode(error),
        this.deps.clock.now() - startedAt,
        providerFailureDetail(error)
      )
      throw providerFailureAppError(error) ?? error
    }
    context.progress(70, 'validating output')
    const output = parseSuggestionOutput(responseText)
    validateSuggestionOutput(base, output)

    const now = this.deps.clock.now()
    const id = newId('promptSuggestion')
    withEvents(this.deps.db, this.deps.events, (events) => {
      this.deps.db
        .prepare(
          `insert into prompt_suggestions
           (id, job_id, base_kind, base_version_id, base_draft_id, base_draft_revision, base_draft_row_version,
            base_content_hash, operations_json, warnings_json, intent, status, provider_invocation_id, created_at)
           values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'proposed', ?, ?)`
        )
        .run(
          id,
          context.jobId,
          payload.baseKind,
          payload.baseKind === 'prompt_version' ? payload.baseVersionId : null,
          payload.baseKind === 'prompt_draft' ? payload.baseDraftId : null,
          payload.baseKind === 'prompt_draft' ? payload.baseDraftRevision : null,
          payload.baseKind === 'prompt_draft' ? payload.baseDraftRowVersion : null,
          payload.baseContentHash,
          JSON.stringify(output.operations),
          JSON.stringify(output.warnings),
          payload.intent,
          invocationId,
          now
        )
      this.deps.audit.append({
        actor: { kind: 'local-user' },
        action: 'prompt.suggestion.proposed',
        targetType: 'prompt_suggestion',
        targetId: id,
        outcome: 'success',
        requestId: context.jobId,
        traceId: context.jobId,
        metadata: { base: baseLabel(payload.baseKind), operations: output.operations.length }
      })
      events.append({
        type: 'prompt.suggestion.proposed',
        scopeKind: 'project',
        scopeId: payload.artProjectId,
        payload: { suggestionId: id }
      })
    })
    context.progress(100, 'ready')
    return { suggestionId: id }
  }

  accept(
    suggestionId: string,
    expectedDraftRowVersion: number | null,
    ids: RequestIds,
    operationIndexes?: number[]
  ): { suggestion: PromptSuggestionDto; draft: PromptDraftDto } {
    const suggestion = this.get(suggestionId)
    if (suggestion.status !== 'proposed') {
      throw new AppError('PROMPT_SUGGESTION_RESOLVED', { status: suggestion.status })
    }
    const appliedIndexes =
      operationIndexes === undefined
        ? suggestion.operations.map((_, index) => index)
        : [...operationIndexes].sort((left, right) => left - right)
    const selectedOperations = appliedIndexes.map((index) => {
      const operation = suggestion.operations[index]
      if (!operation) {
        throw new AppError('REQUEST_INVALID', {
          reason: `operation index ${index} is out of range`
        })
      }
      return operation
    })

    let base: PromptSpecV2
    let version: PromptVersionDto | null = null
    if (suggestion.baseKind === 'prompt_version') {
      version = this.requireVersion(suggestion.baseVersionId!)
      base = version.state
      if (version.contentHash !== suggestion.baseContentHash) {
        this.markStale(suggestionId, ids)
      }
    } else {
      const baseDraft = this.deps.drafts.getRow(suggestion.artProjectId, suggestion.baseDraftId!)
      base = this.parseStoredState(baseDraft.state_json)
    }

    let draft = this.deps.drafts.getActiveRow(suggestion.artProjectId)
    if (suggestion.baseKind === 'prompt_draft') {
      if (
        !draft ||
        draft.id !== suggestion.baseDraftId ||
        draft.content_hash !== suggestion.baseContentHash
      ) {
        this.markStale(suggestionId, ids)
      }
      const active = draft!
      if (expectedDraftRowVersion === null || expectedDraftRowVersion !== active.row_version) {
        throw new AppError('ROW_VERSION_CONFLICT', {
          expected: expectedDraftRowVersion ?? 0,
          actual: active.row_version
        })
      }
    } else if (draft) {
      if (draft.base_version_id !== version!.id || draft.content_hash !== suggestion.baseContentHash) {
        this.markStale(suggestionId, ids)
      }
      if (expectedDraftRowVersion === null || expectedDraftRowVersion !== draft.row_version) {
        throw new AppError('ROW_VERSION_CONFLICT', {
          expected: expectedDraftRowVersion ?? 0,
          actual: draft.row_version
        })
      }
    } else if (expectedDraftRowVersion !== null) {
      throw new AppError('REQUEST_INVALID', {
        reason: 'expectedDraftRowVersion must be null when no active draft exists'
      })
    }

    let next: PromptSpecV2
    try {
      next = applyPromptOperations(base, selectedOperations, {
        source: 'ai-suggestion',
        respectLockAll: true
      })
    } catch (error) {
      if (error instanceof AppError && error.code === 'PROMPT_OPERATION_STALE') {
        if (operationIndexes !== undefined) {
          throw new AppError('REQUEST_INVALID', {
            reason: 'selected operations cannot be applied to the current base'
          })
        }
        this.markStale(suggestionId, ids)
      }
      throw error
    }

    const submissionId = version ? version.inputSubmissionId : draft!.input_submission_id
    if (!submissionId) {
      throw new AppError('PROMPT_INPUT_REQUIRED', { artProjectId: suggestion.artProjectId })
    }
    const submission = this.deps.submissions.get(suggestion.artProjectId, submissionId)
    const brief = submission.characterBriefVersionId
      ? this.deps.briefs.get(submission.characterBriefVersionId)
      : null
    const normalized = normalizeSpecForSubmission(next, submission, brief)
    const contentHash = specContentHash(normalized)
    const now = this.deps.clock.now()

    return withEvents(this.deps.db, this.deps.events, (events) => {
      let target = draft
      if (!target) {
        target = this.deps.drafts.insertFromVersion(suggestion.artProjectId, version!, now)
        this.deps.audit.append({
          actor: { kind: 'local-user' },
          action: 'prompt.draft.created',
          targetType: 'prompt_draft',
          targetId: target.id,
          outcome: 'success',
          requestId: ids.requestId,
          traceId: ids.traceId,
          metadata: { base: 'version' }
        })
        events.append({
          type: 'prompt.draft.created',
          scopeKind: 'project',
          scopeId: suggestion.artProjectId,
          payload: { draftId: target.id }
        })
      }
      const updated = this.deps.db
        .prepare(
          `update prompt_drafts set state_json = ?, content_hash = ?, revision = revision + 1,
           updated_at = ?, row_version = row_version + 1
           where id = ? and status = 'active' and row_version = ?`
        )
        .run(JSON.stringify(normalized), contentHash, now, target.id, target.row_version)
      if (updated.changes !== 1) {
        const actual = this.deps.drafts.getRow(suggestion.artProjectId, target.id).row_version
        throw new AppError('ROW_VERSION_CONFLICT', { expected: target.row_version, actual })
      }
      const resolved = this.deps.db
        .prepare(
          `update prompt_suggestions set status = 'accepted', accepted_draft_id = ?, accepted_draft_revision = ?,
           resolved_at = ? where id = ? and status = 'proposed'`
        )
        .run(target.id, target.revision + 1, now, suggestionId)
      if (resolved.changes !== 1) {
        throw new AppError('PROMPT_SUGGESTION_RESOLVED', { status: 'accepted' })
      }
      this.deps.audit.append({
        actor: { kind: 'local-user' },
        action: 'prompt.suggestion.accepted',
        targetType: 'prompt_suggestion',
        targetId: suggestionId,
        outcome: 'success',
        requestId: ids.requestId,
        traceId: ids.traceId,
        metadata: {
          base: baseLabel(suggestion.baseKind),
          operations: selectedOperations.length,
          totalOperations: suggestion.operations.length,
          operationIndexes: appliedIndexes.join(',')
        }
      })
      events.append({
        type: 'prompt.suggestion.accepted',
        scopeKind: 'project',
        scopeId: suggestion.artProjectId,
        payload: { suggestionId, draftId: target.id }
      })
      return {
        suggestion: this.get(suggestionId),
        draft: this.deps.drafts.requireDraft(target.id)
      }
    })
  }

  reject(suggestionId: string, ids: RequestIds): PromptSuggestionDto {
    return withEvents(this.deps.db, this.deps.events, (events) => {
      const row = this.get(suggestionId)
      if (row.status === 'rejected') return this.get(suggestionId)
      if (row.status !== 'proposed') {
        throw new AppError('PROMPT_SUGGESTION_RESOLVED', { status: row.status })
      }
      const now = this.deps.clock.now()
      const changed = this.deps.db
        .prepare(
          `update prompt_suggestions set status = 'rejected', resolved_at = ? where id = ? and status = 'proposed'`
        )
        .run(now, suggestionId)
      if (changed.changes !== 1) {
        throw new AppError('PROMPT_SUGGESTION_RESOLVED', { status: 'rejected' })
      }
      this.deps.audit.append({
        actor: { kind: 'local-user' },
        action: 'prompt.suggestion.rejected',
        targetType: 'prompt_suggestion',
        targetId: suggestionId,
        outcome: 'success',
        requestId: ids.requestId,
        traceId: ids.traceId,
        metadata: {}
      })
      events.append({
        type: 'prompt.suggestion.rejected',
        scopeKind: 'project',
        scopeId: row.artProjectId,
        payload: { suggestionId }
      })
      return this.get(suggestionId)
    })
  }

  get(suggestionId: string): PromptSuggestionDto {
    return this.requireRow(suggestionId)
  }

  private markStale(suggestionId: string, ids: RequestIds): never {
    const now = this.deps.clock.now()
    withEvents(this.deps.db, this.deps.events, (events) => {
      const row = this.get(suggestionId)
      if (row.status !== 'proposed') {
        throw new AppError('PROMPT_SUGGESTION_RESOLVED', { status: row.status })
      }
      const changed = this.deps.db
        .prepare(
          `update prompt_suggestions set status = 'stale', resolved_at = ? where id = ? and status = 'proposed'`
        )
        .run(now, suggestionId)
      if (changed.changes !== 1) {
        throw new AppError('PROMPT_SUGGESTION_RESOLVED', { status: 'stale' })
      }
      this.deps.audit.append({
        actor: { kind: 'local-user' },
        action: 'prompt.suggestion.stale',
        targetType: 'prompt_suggestion',
        targetId: suggestionId,
        outcome: 'failed',
        requestId: ids.requestId,
        traceId: ids.traceId,
        metadata: {}
      })
      events.append({
        type: 'prompt.suggestion.stale',
        scopeKind: 'project',
        scopeId: row.artProjectId,
        payload: { suggestionId }
      })
    })
    const row = this.get(suggestionId)
    throw new AppError('PROMPT_BASE_STALE', {
      expectedHash: row.baseContentHash,
      actualHash: this.currentHash(row)
    })
  }

  private requireRow(suggestionId: string): PromptSuggestionDto {
    const row = this.deps.db
      .prepare(
        `select s.*, coalesce(d.art_project_id, v.art_project_id) as art_project_id
         from prompt_suggestions s
         left join prompt_drafts d on d.id = s.base_draft_id
         left join prompt_versions v on v.id = s.base_version_id
         where s.id = ?`
      )
      .get(suggestionId) as PromptSuggestionRow | undefined
    if (!row) throw new AppError('RESOURCE_NOT_FOUND', { resource: 'promptSuggestion' })
    const stored = this.parseStoredOutput(row)
    return {
      id: row.id,
      artProjectId: row.art_project_id,
      jobId: row.job_id,
      baseKind: row.base_kind,
      baseVersionId: row.base_version_id,
      baseDraftId: row.base_draft_id,
      baseDraftRevision: row.base_draft_revision,
      baseDraftRowVersion: row.base_draft_row_version,
      baseContentHash: row.base_content_hash,
      operations: stored.operations,
      warnings: stored.warnings,
      intent: row.intent,
      status: row.status,
      acceptedDraftId: row.accepted_draft_id,
      acceptedDraftRevision: row.accepted_draft_revision,
      createdAt: row.created_at,
      resolvedAt: row.resolved_at
    }
  }

  private loadFreshBase(payload: PromptSuggestionPayload): PromptSpecV2 {
    if (payload.baseKind === 'prompt_version') {
      const version = this.requireVersion(payload.baseVersionId)
      if (version.contentHash !== payload.baseContentHash) {
        throw new AppError('PROMPT_BASE_STALE', {
          expectedHash: payload.baseContentHash,
          actualHash: version.contentHash
        })
      }
      return version.state
    }
    const draft = this.deps.drafts.getRow(payload.artProjectId, payload.baseDraftId)
    if (
      draft.status !== 'active' ||
      draft.revision !== payload.baseDraftRevision ||
      draft.content_hash !== payload.baseContentHash
    ) {
      throw new AppError('PROMPT_BASE_STALE', {
        expectedHash: payload.baseContentHash,
        actualHash: draft.content_hash
      })
    }
    return this.parseStoredState(draft.state_json)
  }

  private loadPinnedBrief(payload: PromptSuggestionPayload): CharacterBriefVersion | null {
    const submissionId = this.baseSubmissionId(payload)
    if (!submissionId) {
      throw new AppError('PROMPT_INPUT_REQUIRED', { artProjectId: payload.artProjectId })
    }
    const submission = this.deps.submissions.get(payload.artProjectId, submissionId)
    if (submission.characterBriefVersionId !== payload.characterBriefVersionId) {
      throw new AppError('PROMPT_BRIEF_PROJECTION_STALE', {})
    }
    return submission.characterBriefVersionId
      ? this.deps.briefs.get(submission.characterBriefVersionId)
      : null
  }

  private baseSubmissionId(payload: PromptSuggestionPayload): string | null {
    if (payload.baseKind === 'prompt_version') {
      return this.requireVersion(payload.baseVersionId).inputSubmissionId
    }
    return this.deps.drafts.getRow(payload.artProjectId, payload.baseDraftId).input_submission_id
  }

  private currentHash(row: PromptSuggestionDto): string {
    if (row.baseKind === 'prompt_version') {
      return this.requireVersion(row.baseVersionId!).contentHash
    }
    const draft = this.deps.drafts.getActiveRow(row.artProjectId)
    return draft && draft.id === row.baseDraftId ? draft.content_hash : '0'.repeat(64)
  }

  private requireChatConnection(connectionId: string): ProviderConnectionRow {
    const connection = this.deps.connections.getRow(connectionId)
    if (!connection.enabled) {
      throw new AppError('PROVIDER_NOT_CONFIGURED', { connectionId })
    }
    const capabilities = providerCapabilitiesSchema.parse(JSON.parse(connection.capabilities_json))
    if (connection.kind !== 'chat' || !capabilities.chat) {
      throw new AppError('PROVIDER_CAPABILITY_UNSUPPORTED', { capability: 'chat' })
    }
    return connection
  }

  private requireVersion(versionId: string): PromptVersionDto {
    try {
      return this.deps.versions.requireById(versionId)
    } catch (error) {
      if (error instanceof AppError) throw error
      throw new AppError('SYS_INTERNAL', {})
    }
  }

  private parseStoredState(raw: string): PromptSpecV2 {
    try {
      return normalizeLegacyFullPrompt(promptSpecSchema.parse(JSON.parse(raw)))
    } catch {
      throw new AppError('SYS_INTERNAL', {})
    }
  }

  private parseStoredOutput(row: PromptSuggestionRow): PromptSuggestionOutput {
    try {
      return promptSuggestionOutputSchema.parse({
        operations: JSON.parse(row.operations_json),
        warnings: JSON.parse(row.warnings_json)
      })
    } catch {
      throw new AppError('SYS_INTERNAL', {})
    }
  }
}
