import React, { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { PromptDraftDto, PromptWorkspaceDto, ProviderConnectionDto } from '@studio/api'
import { getPromptReverseResult, isTerminalJobStatus, queryKeys, requestPromptReverse } from '@studio/api'
import { useJob } from '@studio/hooks'
import { connectionDisplayName, connectionModels, modelOptionLabel } from '@studio/providers'
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
import { ReverseReview } from '../../ReverseReview'
import styles from './ReverseDialog.module.scss'

type ReverseJob = { kind: 'reverse'; jobId: string }

export interface ReverseDialogProps {
  open: boolean
  projectId: string
  workspace: PromptWorkspaceDto
  providers: ProviderConnectionDto[]
  providersLoading: boolean
  providersError: string | null
  dirty: boolean
  draftRowVersion: number | null
  initialJob: ReverseJob | null
  onClose(): void
  onDraftUpdated(draft: PromptDraftDto): void
  onJobStarted(job: ReverseJob): void
  onJobResolved(): void
}

export const ReverseDialog: React.FC<ReverseDialogProps> = ({
  open,
  projectId,
  workspace,
  providers,
  providersLoading,
  providersError,
  dirty,
  draftRowVersion,
  initialJob,
  onClose,
  onDraftUpdated,
  onJobStarted,
  onJobResolved
}) => {
  const queryClient = useQueryClient()
  const draftSpec = workspace.activeDraft?.state ?? workspace.activePromptVersion?.state ?? null
  const references = draftSpec?.materialRefs ?? []
  const available = useMemo(
    () =>
      providers
        .filter((provider) => provider.enabled)
        .flatMap((provider) =>
          connectionModels(provider, 'chat')
            .filter((model) => references.length === 0 || model.capabilities.chat?.supportsVision === true)
            .map((model) => ({ provider, model }))
        ),
    [providers, references.length]
  )
  const initial = available.find((entry) => entry.provider.model === entry.model.id) ?? available[0]
  const [providerId, setProviderId] = useState(initial?.provider.id ?? '')
  const [modelId, setModelId] = useState(initial?.model.id ?? '')
  const [activeJob, setActiveJob] = useState<ReverseJob | null>(initialJob)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const providerOptions = useMemo(
    () => [...new Map(available.map((entry) => [entry.provider.id, entry.provider])).values()],
    [available]
  )
  const modelOptions = useMemo(
    () => available.filter((entry) => entry.provider.id === providerId),
    [available, providerId]
  )

  useEffect(() => {
    if (!open) return
    setActiveJob(initialJob)
    setError(null)
  }, [open, initialJob?.jobId])

  useEffect(() => {
    if (!available.some((entry) => entry.provider.id === providerId)) {
      const first = available[0]
      const models = available.filter((entry) => entry.provider.id === first?.provider.id)
      const preferred = models.find((entry) => entry.model.id === first?.provider.model) ?? models[0]
      setProviderId(first?.provider.id ?? '')
      setModelId(preferred?.model.id ?? '')
    }
  }, [available, providerId])

  useEffect(() => {
    if (modelOptions.some((entry) => entry.model.id === modelId)) return
    const preferred =
      modelOptions.find((entry) => entry.model.id === modelOptions[0]?.provider.model) ?? modelOptions[0]
    setModelId(preferred?.model.id ?? '')
  }, [modelOptions, modelId])

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

  const failed = job?.status === 'failed' || job?.status === 'cancelled' || job?.status === 'unknown_outcome'
  const noResult = terminal && job?.status === 'succeeded' && !resultId
  const needsRetry = failed || noResult

  const start = (): void => {
    if (!providerId || !modelId || dirty) return
    if (needsRetry) {
      setActiveJob(null)
      onJobResolved()
    }
    setBusy(true)
    setError(null)
    requestPromptReverse(projectId, { providerConnectionId: providerId, modelId })
      .then((created) => {
        const next = { kind: 'reverse' as const, jobId: created.jobId }
        setActiveJob(next)
        onJobStarted(next)
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setBusy(false))
  }

  const close = (): void => {
    onJobResolved()
    onClose()
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close()
      }}
      title="读参考图生成"
      description="用视觉模型把参考图反推成提示词块。"
      busy={busy}
      className={styles['wb3-ai-dialog']!}
      footer={
        <>
          <span className={styles['wb3-dialog-spacer']!} />
          <Button variant="quiet" disabled={busy} onClick={close}>
            关闭
          </Button>
          <AsyncButton
            variant="primary"
            busy={busy}
            busyLabel="提交任务…"
            disabled={
              !providerId ||
              !modelId ||
              dirty ||
              providersLoading ||
              Boolean(providersError) ||
              (activeJob !== null && !needsRetry)
            }
            onClick={start}
          >
            {needsRetry ? '重试' : '开始反推'}
          </AsyncButton>
        </>
      }
    >
      <div className={styles['wb3-dialog-stack']!}>
        {providersError ? (
          <InlineNotice tone="danger">{providersError}</InlineNotice>
        ) : providersLoading ? (
          <InlineNotice tone="info">正在加载模型连接…</InlineNotice>
        ) : available.length === 0 ? (
          <EmptyState
            title="没有可用的视觉聊天连接"
            description={
              references.length > 0
                ? '参考图反推需要启用支持视觉输入的聊天连接。'
                : '在设置中添加并启用一个聊天连接。'
            }
          />
        ) : (
          <>
            <Field label="供应商">
              <Select
                value={providerId}
                disabled={busy || (activeJob !== null && !needsRetry)}
                onValueChange={setProviderId}
              >
                {providerOptions.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {connectionDisplayName(provider)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="视觉模型">
              <Select
                value={modelId}
                disabled={busy || (activeJob !== null && !needsRetry)}
                onValueChange={setModelId}
              >
                {modelOptions.map(({ model }) => (
                  <option key={model.id} value={model.id}>
                    {modelOptionLabel(model)}
                  </option>
                ))}
              </Select>
            </Field>
          </>
        )}

        {dirty ? <InlineNotice tone="warning">先保存或撤销未保存的提示词修改，再反推。</InlineNotice> : null}

        {activeJob ? (
          <div className={styles['job-banner']!}>
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

        {noResult ? (
          <div role="alert">
            <InlineNotice tone="danger">任务结束但没有返回反推结果，请重试。</InlineNotice>
          </div>
        ) : null}

        {resultQuery.data ? (
          <ReverseReview
            result={resultQuery.data}
            activeDraftRowVersion={draftRowVersion}
            disabled={dirty}
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
