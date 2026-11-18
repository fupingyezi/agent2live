import React, { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { PromptDraftDto, PromptWorkspaceDto, ProviderConnectionDto } from '@studio/api'
import { getPromptReverseResult, isTerminalJobStatus, queryKeys, requestPromptReverse } from '@studio/api'
import { useJob } from '@studio/hooks'
import {
  AsyncButton,
  Button,
  Dialog,
  EmptyState,
  Field,
  InlineNotice,
  ProgressBar,
  Select,
  StatusPill
} from '@agent2live/design-system'
import { ReverseReview } from '../ReverseReview'

type ReverseJob = { kind: 'reverse'; jobId: string }

export interface ReverseDialogProps {
  open: boolean
  projectId: string
  workspace: PromptWorkspaceDto
  providers: ProviderConnectionDto[]
  initialJob: ReverseJob | null
  onClose(): void
  onDraftUpdated(draft: PromptDraftDto): void
  onJobStarted(job: ReverseJob): void
  onJobResolved(): void
}

function supportsVision(provider: ProviderConnectionDto): boolean {
  if (!provider.capabilities || typeof provider.capabilities !== 'object') return false
  const chat = (provider.capabilities as { chat?: { supportsVision?: unknown } }).chat
  return chat?.supportsVision === true
}

export const ReverseDialog: React.FC<ReverseDialogProps> = ({
  open,
  projectId,
  workspace,
  providers,
  initialJob,
  onClose,
  onDraftUpdated,
  onJobStarted,
  onJobResolved
}) => {
  const queryClient = useQueryClient()
  const draftSpec = workspace.activeDraft?.state ?? workspace.activePromptVersion?.state ?? null
  const references = draftSpec?.materialRefs ?? []
  const chatProviders = useMemo(
    () => providers.filter((provider) => provider.enabled && provider.kind === 'chat'),
    [providers]
  )
  const available = useMemo(
    () => (references.length > 0 ? chatProviders.filter(supportsVision) : chatProviders),
    [chatProviders, references.length]
  )
  const [providerId, setProviderId] = useState(available[0]?.id ?? '')
  const [activeJob, setActiveJob] = useState<ReverseJob | null>(initialJob)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setActiveJob(initialJob)
    setError(null)
  }, [open, initialJob?.jobId])

  useEffect(() => {
    if (!available.some((provider) => provider.id === providerId)) {
      setProviderId(available[0]?.id ?? '')
    }
  }, [available, providerId])

  const jobQuery = useJob(activeJob?.jobId ?? null)
  const job = jobQuery.data ?? null
  const terminal = job ? isTerminalJobStatus(job.status) : false
  const resultId =
    terminal && job?.status === 'succeeded' && job.result && typeof job.result === 'object'
      ? (((job.result as { reverseResultId?: unknown }).reverseResultId as string | undefined) ?? null)
      : null
  const resultQuery = useQuery({
    queryKey: queryKeys.reverseResult(projectId, resultId ?? 'none'),
    queryFn: ({ signal }) => getPromptReverseResult(resultId!, signal),
    enabled: Boolean(resultId)
  })

  const start = (): void => {
    if (!providerId) return
    setBusy(true)
    setError(null)
    requestPromptReverse(projectId, providerId)
      .then((created) => {
        const next = { kind: 'reverse' as const, jobId: created.jobId }
        setActiveJob(next)
        onJobStarted(next)
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setBusy(false))
  }

  const failed = job?.status === 'failed' || job?.status === 'cancelled' || job?.status === 'unknown_outcome'

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          onJobResolved()
          onClose()
        }
      }}
      title="读参考图生成"
      description="用视觉模型把参考图反推成提示词块。"
      busy={busy}
      className="wb3-ai-dialog"
      footer={
        <>
          <span className="wb3-dialog-spacer" />
          <Button variant="quiet" disabled={busy} onClick={onClose}>
            关闭
          </Button>
          <AsyncButton
            variant="primary"
            busy={busy}
            busyLabel="提交任务…"
            disabled={!providerId || activeJob !== null}
            onClick={start}
          >
            {failed ? '重试' : '开始反推'}
          </AsyncButton>
        </>
      }
    >
      <div className="wb3-dialog-stack">
        {available.length === 0 ? (
          <EmptyState
            title="没有可用的视觉聊天连接"
            description={
              references.length > 0
                ? '参考图反推需要启用支持视觉输入的聊天连接。'
                : '在设置中添加并启用一个聊天连接。'
            }
          />
        ) : (
          <Field label="视觉模型">
            <Select value={providerId} disabled={busy || activeJob !== null} onValueChange={setProviderId}>
              {available.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.label}
                </option>
              ))}
            </Select>
          </Field>
        )}

        {activeJob ? (
          <div className="job-banner">
            <StatusPill
              label={job?.status ?? 'queued'}
              tone={job?.status === 'failed' ? 'danger' : job?.status === 'succeeded' ? 'success' : 'accent'}
            />
            {job?.progress !== null && job?.progress !== undefined ? (
              <ProgressBar label="反推进度" value={job.progress} />
            ) : null}
          </div>
        ) : null}

        {failed ? (
          <div role="alert">
            <InlineNotice tone="danger">
              反推失败：{job?.errorMessage ?? job?.errorCode ?? '未知错误'}
            </InlineNotice>
          </div>
        ) : null}

        {resultQuery.data ? (
          <ReverseReview
            result={resultQuery.data}
            activeDraftRowVersion={workspace.activeDraft?.rowVersion ?? null}
            disabled={false}
            onResolved={(draft) => {
              if (draft) onDraftUpdated(draft)
              void queryClient.invalidateQueries({ queryKey: queryKeys.workspace(projectId) })
              onJobResolved()
              onClose()
            }}
          />
        ) : null}

        {resultQuery.isError ? (
          <div role="alert">
            <InlineNotice tone="danger">反推结果加载失败，请关闭后重试。</InlineNotice>
          </div>
        ) : null}
        {error ? (
          <div role="alert">
            <InlineNotice tone="danger">{error}</InlineNotice>
          </div>
        ) : null}
      </div>
    </Dialog>
  )
}
