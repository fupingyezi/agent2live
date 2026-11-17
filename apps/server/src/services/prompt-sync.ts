import type Database from 'better-sqlite3'
import {
  hashCanonical,
  providerCapabilitiesSchema,
  type PromptSyncInput,
  type PromptSyncResultDto
} from '@agent2live/contracts'
import { AppError } from '../errors'
import { parsePromptSyncOutput, applyPromptSyncOutput, buildPromptSyncMessages } from '../prompt/sync'
import type { JobHandlerContext } from '../jobs/types'
import type { PromptSyncPayload } from '../jobs/prompt-sync'
import type { Clock } from './clock'
import type { AuditService } from './audit'
import type { CharacterBriefService } from './character-briefs'
import type { PromptDraftService } from './prompt-drafts'
import type { PromptSubmissionRepository } from './prompt-submissions'
import type { ProviderConnectionService } from './provider-connections'
import type { ProviderInvocationService } from './provider-invocations'
import type { ProviderRegistry } from './provider-registry'
import type { ProjectService } from './projects'
import { providerFailureAppError, providerFailureDetail } from './provider-diagnostics'

export interface PromptSyncDeps {
  db: Database.Database
  clock: Clock
  projects: ProjectService
  drafts: PromptDraftService
  submissions: PromptSubmissionRepository
  briefs: CharacterBriefService
  connections: ProviderConnectionService
  registry: ProviderRegistry
  invocations: ProviderInvocationService
  audit: AuditService
}

export class PromptSyncService {
  constructor(private readonly deps: PromptSyncDeps) {}

  prepare(
    projectId: string,
    draftId: string,
    expectedRowVersion: number,
    input: PromptSyncInput
  ): PromptSyncPayload {
    this.deps.projects.getWritable(projectId)
    const draft = this.deps.drafts.requireActiveDraft(projectId, draftId, expectedRowVersion)
    if (!draft.input_submission_id) {
      throw new AppError('PROMPT_INPUT_REQUIRED', { artProjectId: projectId })
    }
    const submission = this.deps.submissions.get(projectId, draft.input_submission_id)
    const connection = this.requireChatConnection(input.providerConnectionId)
    return {
      artProjectId: projectId,
      draftId,
      providerConnectionId: connection.id,
      characterBriefVersionId: submission.characterBriefVersionId,
      source: input.source,
      mode: input.mode,
      state: input.state,
      baseDraftRevision: draft.revision,
      baseDraftRowVersion: draft.row_version,
      baseContentHash: draft.content_hash,
      mockProtocol: connection.adapter === 'mock'
    }
  }

  async run(context: JobHandlerContext<PromptSyncPayload>): Promise<PromptSyncResultDto> {
    const payload = context.payload
    const draft = this.deps.drafts.getRow(payload.artProjectId, payload.draftId)
    if (
      draft.status !== 'active' ||
      draft.revision !== payload.baseDraftRevision ||
      draft.content_hash !== payload.baseContentHash
    ) {
      throw new AppError('PROMPT_SYNC_STALE', {
        baseDraftRowVersion: payload.baseDraftRowVersion,
        currentDraftRowVersion: draft.status === 'active' ? draft.row_version : null
      })
    }
    const submission = this.deps.submissions.get(payload.artProjectId, draft.input_submission_id!)
    if (submission.characterBriefVersionId !== payload.characterBriefVersionId) {
      throw new AppError('PROMPT_SYNC_STALE', {
        baseDraftRowVersion: payload.baseDraftRowVersion,
        currentDraftRowVersion: draft.row_version
      })
    }
    const brief = submission.characterBriefVersionId
      ? this.deps.briefs.get(submission.characterBriefVersionId)
      : null
    const connection = this.requireChatConnection(payload.providerConnectionId)
    const provider = await this.deps.registry.chat(connection.id)
    const { messages } = buildPromptSyncMessages(
      {
        providerConnectionId: payload.providerConnectionId,
        source: payload.source,
        mode: payload.mode,
        state: payload.state
      },
      brief
    )
    const requestHash = hashCanonical({
      purpose: 'prompt.sync',
      artProjectId: payload.artProjectId,
      draftId: payload.draftId,
      source: payload.source,
      mode: payload.mode,
      fullPrompt: payload.state.fullPrompt,
      blocks: payload.state.blocks,
      providerConnectionId: payload.providerConnectionId,
      schema: 'prompt-sync/1'
    })
    const startedAt = this.deps.clock.now()
    const invocationId = this.deps.invocations.start({
      connectionId: connection.id,
      purpose: 'prompt.suggestion',
      requestHash,
      model: connection.model
    })
    context.progress(20, 'calling provider')
    let responseText: string
    try {
      const response = await provider.generate(
        { messages, maxTokens: 12_000, responseFormat: 'json' },
        { requestId: context.jobId, signal: context.signal, timeoutMs: 90_000 }
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
        (error as { code?: string }).code ?? 'SYS_INTERNAL',
        this.deps.clock.now() - startedAt,
        providerFailureDetail(error)
      )
      throw providerFailureAppError(error) ?? error
    }
    context.progress(70, 'validating output')
    const output = parsePromptSyncOutput(responseText)
    const result = applyPromptSyncOutput(
      {
        providerConnectionId: payload.providerConnectionId,
        source: payload.source,
        mode: payload.mode,
        state: payload.state
      },
      output
    )
    this.deps.audit.append({
      actor: { kind: 'local-user' },
      action: 'prompt.sync.completed',
      targetType: 'prompt_draft',
      targetId: payload.draftId,
      outcome: 'success',
      requestId: context.jobId,
      traceId: context.jobId,
      metadata: { source: payload.source, conflicts: result.conflicts.length }
    })
    return result
  }

  private requireChatConnection(connectionId: string) {
    const connection = this.deps.connections.getRow(connectionId)
    const capabilities = providerCapabilitiesSchema.parse(JSON.parse(connection.capabilities_json))
    if (!connection.enabled || connection.kind !== 'chat' || !capabilities.chat) {
      throw new AppError('PROVIDER_CAPABILITY_UNSUPPORTED', { capability: 'chat' })
    }
    return connection
  }
}
