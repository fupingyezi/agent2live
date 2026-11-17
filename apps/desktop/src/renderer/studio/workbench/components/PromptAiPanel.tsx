import React, { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  PromptDraftDto,
  PromptMaterialRef,
  PromptWorkspaceDto,
  ProviderConnectionDto
} from '@studio/api'
import {
  getPromptReverseResult,
  getPromptSuggestion,
  isTerminalJobStatus,
  requestPromptReverse,
  requestPromptSuggestionFromDraft,
  requestPromptSuggestionFromVersion
} from '@studio/api'
import { queryKeys } from '@studio/api'
import { useJob } from '@studio/hooks'
import { formatPercent } from '@studio/format'
import {
  AsyncButton,
  Button,
  EmptyState,
  Field,
  InlineNotice,
  Select,
  StatusPill,
  Tabs,
  Textarea
} from '@agent2live/design-system'
import { ReverseReview } from './ReverseReview'
import { SuggestionDiff } from './SuggestionDiff'
import { StudioError } from '@studio/components'

type AiKind = 'reverse' | 'suggest'

export interface InitialPromptJob {
  kind: AiKind
  jobId: string
}

export interface ActiveAiJob {
  kind: AiKind
  jobId: string
}

function resultId(jobResult: unknown, key: 'reverseResultId' | 'suggestionId'): string | null {
  if (!jobResult || typeof jobResult !== 'object') return null
  const value = (jobResult as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : null
}

export interface PromptAiPanelProps {
  projectId: string
  workspace: PromptWorkspaceDto
  references: PromptMaterialRef[]
  providers: ProviderConnectionDto[]
  dirty: boolean
  initialJob: InitialPromptJob | null
  onDraftUpdated: (draft: PromptDraftDto) => void
  onJobStarted?: (job: ActiveAiJob) => void
  onJobResolved?: () => void
}

export const PromptAiPanel: React.FC<PromptAiPanelProps> = ({
  projectId,
  workspace,
  references,
  providers,
  dirty,
  initialJob,
  onDraftUpdated,
  onJobStarted,
  onJobResolved
}) => {
  const queryClient = useQueryClient()
  const chatProviders = useMemo(
    () => providers.filter((provider) => provider.enabled && provider.kind === 'chat'),
    [providers]
  )
  const [kind, setKind] = useState<AiKind>('reverse')
  const [providerId, setProviderId] = useState(chatProviders[0]?.id ?? '')
  const [intent, setIntent] = useState('让角色更贴合当前世界观，同时保持面部一致')
  const [base, setBase] = useState<'draft' | 'version'>(workspace.activeDraft ? 'draft' : 'version')
  const [activeJob, setActiveJob] = useState<ActiveAiJob | null>(initialJob)
  const [localError, setLocalError] = useState<string | null>(null)
  const hasMaterials = references.length > 0
  const reverseNeedsVision = kind === 'reverse' && hasMaterials
  const availableChatProviders = useMemo(
    () =>
      reverseNeedsVision
        ? chatProviders.filter((provider) => {
            if (!provider.capabilities || typeof provider.capabilities !== 'object') return false
            const chat = (provider.capabilities as { chat?: { supportsVision?: unknown } }).chat
            return chat?.supportsVision === true
          })
        : chatProviders,
    [chatProviders, reverseNeedsVision]
  )

  useEffect(() => {
    if (!availableChatProviders.some((provider) => provider.id === providerId)) {
      setProviderId(availableChatProviders[0]?.id ?? '')
    }
  }, [providerId, availableChatProviders])

  useEffect(() => {
    setActiveJob(initialJob)
  }, [initialJob?.jobId, initialJob?.kind])

  const jobQuery = useJob(activeJob?.jobId ?? null)
  const job = jobQuery.data ?? null
  const terminal = job ? isTerminalJobStatus(job.status) : false
  const reverseResultId =
    activeJob?.kind === 'reverse' && terminal ? resultId(job?.result, 'reverseResultId') : null
  const suggestionId =
    activeJob?.kind === 'suggest' && terminal ? resultId(job?.result, 'suggestionId') : null

  const reverseQuery = useQuery({
    queryKey: queryKeys.reverseResult(projectId, reverseResultId ?? 'none'),
    queryFn: ({ signal }) => getPromptReverseResult(reverseResultId!, signal),
    enabled: Boolean(reverseResultId)
  })
  const suggestionQuery = useQuery({
    queryKey: queryKeys.suggestion(projectId, suggestionId ?? 'none'),
    queryFn: ({ signal }) => getPromptSuggestion(suggestionId!, signal),
    enabled: Boolean(suggestionId)
  })

  const startMutation = useMutation({
    mutationFn: async () => {
      if (!providerId) throw new Error('请选择聊天模型连接。')
      if (kind === 'reverse') {
        const created = await requestPromptReverse(projectId, providerId)
        return { kind, jobId: created.jobId } satisfies ActiveAiJob
      }
      if (intent.trim().length === 0) throw new Error('请描述你希望 AI 改进的方向。')
      if (base === 'draft') {
        if (!workspace.activeDraft) throw new Error('当前版本暂不可编辑。')
        const created = await requestPromptSuggestionFromDraft(
          projectId,
          workspace.activeDraft.id,
          providerId,
          intent.trim()
        )
        return { kind, jobId: created.jobId } satisfies ActiveAiJob
      }
      if (!workspace.activePromptVersion) throw new Error('当前没有提示词版本。')
      const created = await requestPromptSuggestionFromVersion(
        workspace.activePromptVersion.id,
        providerId,
        intent.trim()
      )
      return { kind, jobId: created.jobId } satisfies ActiveAiJob
    },
    onMutate: () => setLocalError(null),
    onSuccess: (created) => {
      setActiveJob(created)
      setLocalError(null)
      onJobStarted?.(created)
    },
    onError: (error) => setLocalError(error instanceof Error ? error.message : String(error))
  })

  const resolve = (draft: PromptDraftDto | null): void => {
    setActiveJob(null)
    onJobResolved?.()
    void queryClient.invalidateQueries({ queryKey: queryKeys.workspace(projectId) })
    void queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId) })
    void queryClient.invalidateQueries({ queryKey: queryKeys.lineages })
    void queryClient.invalidateQueries({ queryKey: queryKeys.characters })
    if (draft) onDraftUpdated(draft)
  }

  if (chatProviders.length === 0 && !activeJob) {
    return (
      <div className="sidebar-panel">
        <EmptyState
          title="没有可用的聊天模型"
          description="在设置中添加 DeepSeek、OpenAI-compatible 或 Mock 聊天连接。"
        />
      </div>
    )
  }

  return (
    <div className="sidebar-panel ai-panel" data-testid="prompt-ai-panel">
      <Tabs
        label="AI 功能"
        value={kind}
        onValueChange={(value) => setKind(value as AiKind)}
        items={[
          { id: 'reverse', label: '素材反推' },
          { id: 'suggest', label: '改进建议' }
        ]}
      />

      {availableChatProviders.length === 0 ? (
        <InlineNotice tone="warning">
          {reverseNeedsVision
            ? '当前草稿带参考图，反推需要启用支持视觉输入的聊天连接；也可移除参考图后按文字设定反推。'
            : '没有可用的聊天模型连接，请在设置中启用。'}
        </InlineNotice>
      ) : (
        <details className="ai-request-settings">
          <summary>模型与改进方向</summary>
          <div className="ai-request-settings-body" data-testid="ai-request-settings">
            <Field label="聊天模型">
              <Select value={providerId} onValueChange={setProviderId}>
                {availableChatProviders.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.label}
                  </option>
                ))}
              </Select>
            </Field>

            {kind === 'suggest' ? (
              <>
                <Field label="改进方向">
                  <Textarea rows={3} maxLength={2000} value={intent} onValueChange={setIntent} />
                </Field>
                <fieldset className="choice-group">
                  <legend>建议基准</legend>
                  <div className="choice-group-actions">
                    <Button
                      type="button"
                      variant={base === 'draft' ? 'secondary' : 'quiet'}
                      size="sm"
                      aria-pressed={base === 'draft'}
                      disabled={!workspace.activeDraft}
                      onClick={() => setBase('draft')}
                    >
                      当前编辑
                    </Button>
                    <Button
                      type="button"
                      variant={base === 'version' ? 'secondary' : 'quiet'}
                      size="sm"
                      aria-pressed={base === 'version'}
                      disabled={!workspace.activePromptVersion}
                      onClick={() => setBase('version')}
                    >
                      当前提示词版本
                    </Button>
                  </div>
                </fieldset>
              </>
            ) : null}
          </div>
        </details>
      )}

      {dirty ? <InlineNotice tone="info">先保存或撤销未保存的提示词修改，再请求 AI。</InlineNotice> : null}
      {localError ? (
        <div role="alert">
          <InlineNotice tone="danger">{localError}</InlineNotice>
        </div>
      ) : null}

      <AsyncButton
        type="button"
        busy={startMutation.isPending}
        busyLabel="提交任务…"
        disabled={
          dirty || availableChatProviders.length === 0 || (kind === 'reverse' && !workspace.activeDraft)
        }
        onClick={() => startMutation.mutate()}
      >
        {kind === 'reverse' ? '开始反推' : '生成建议'}
      </AsyncButton>
      {kind === 'reverse' && !workspace.activeDraft ? (
        <p className="muted">当前版本暂不可编辑，反推结果无法应用。</p>
      ) : null}

      {activeJob ? (
        <div className="job-banner" data-testid="ai-job">
          <StatusPill
            label={job?.status ?? 'queued'}
            tone={job?.status === 'failed' ? 'danger' : job?.status === 'succeeded' ? 'success' : 'accent'}
          />
          <code className="job-id">{activeJob.jobId}</code>
          {job?.progress !== null && job?.progress !== undefined ? (
            <span className="job-progress">{formatPercent(job.progress)}</span>
          ) : null}
          {job?.status === 'failed' ? (
            <div role="alert">
              <InlineNotice tone="danger">
                任务失败：{job.errorMessage ?? job.errorCode ?? 'UNKNOWN'}
                {job.errorMessage && job.errorCode ? (
                  <>
                    （<code>{job.errorCode}</code>）
                  </>
                ) : null}
              </InlineNotice>
            </div>
          ) : null}
          {terminal && !reverseResultId && activeJob.kind === 'reverse' ? (
            <div role="alert">
              <InlineNotice tone="danger">任务结束但没有返回反推结果。</InlineNotice>
            </div>
          ) : null}
          {terminal && !suggestionId && activeJob.kind === 'suggest' ? (
            <div role="alert">
              <InlineNotice tone="danger">任务结束但没有返回建议。</InlineNotice>
            </div>
          ) : null}
        </div>
      ) : null}

      {reverseQuery.error ? (
        <StudioError error={reverseQuery.error} onRetry={() => void reverseQuery.refetch()} />
      ) : null}
      {suggestionQuery.error ? (
        <StudioError error={suggestionQuery.error} onRetry={() => void suggestionQuery.refetch()} />
      ) : null}

      {activeJob?.kind === 'reverse' && reverseQuery.data ? (
        <ReverseReview
          result={reverseQuery.data}
          activeDraftRowVersion={workspace.activeDraft?.rowVersion ?? null}
          disabled={dirty}
          onResolved={(draft) => {
            resolve(draft)
          }}
        />
      ) : null}
      {activeJob?.kind === 'suggest' && suggestionQuery.data ? (
        <SuggestionDiff
          suggestion={suggestionQuery.data}
          activeDraftRowVersion={workspace.activeDraft?.rowVersion ?? null}
          disabled={dirty}
          onResolved={(draft) => {
            resolve(draft)
          }}
        />
      ) : null}
    </div>
  )
}
