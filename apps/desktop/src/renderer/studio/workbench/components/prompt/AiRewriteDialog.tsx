import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { PromptDraftDto, PromptOperation, PromptWorkspaceDto, ProviderConnectionDto } from '@studio/api'
import {
  acceptPromptSuggestion,
  getPromptSuggestion,
  isTerminalJobStatus,
  queryKeys,
  rejectPromptSuggestion,
  requestPromptSuggestionFromDraft,
  requestPromptSuggestionFromVersion
} from '@studio/api'
import type { PromptSpecV2 } from '@studio/api'
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
  StatusPill,
  TextField
} from '@agent2live/design-system'
import { blockLabelById } from '../../prompt-diagnostics'

type SuggestJob = { kind: 'suggest'; jobId: string }

export interface AiRewriteDialogProps {
  open: boolean
  projectId: string
  workspace: PromptWorkspaceDto
  spec: PromptSpecV2 | null
  draftRowVersion: number | null
  providers: ProviderConnectionDto[]
  providersLoading: boolean
  providersError: string | null
  initialIntent: string
  autoStart: boolean
  initialJob: SuggestJob | null
  onPrepare(): Promise<void>
  onClose(): void
  onDraftUpdated(draft: PromptDraftDto): void
  onJobStarted(job: SuggestJob): void
  onJobResolved(): void
}

const STEP_LABELS = ['读提示词块', '读参考图', '生成改动建议'] as const

function stepState(index: number, progress: number): 'done' | 'active' | 'waiting' {
  if (index === 0) return progress >= 20 ? 'done' : 'active'
  if (index === 1) return progress < 20 ? 'waiting' : progress < 70 ? 'active' : 'done'
  return progress < 70 ? 'waiting' : progress < 100 ? 'active' : 'done'
}

interface OperationRowProps {
  operation: PromptOperation
  spec: PromptSpecV2 | null
  selected: boolean
  disabled: boolean
  onToggle(): void
}

const OperationRow: React.FC<OperationRowProps> = ({ operation, spec, selected, disabled, onToggle }) => {
  const blockLabel = (blockId: string): string => (spec ? blockLabelById(blockId, spec) : blockId)
  const body = (() => {
    if (operation.op === 'replace') {
      return (
        <>
          <div className="wb3-ai-diff wb3-ai-diff-before">
            <del>{operation.before}</del>
          </div>
          <div className="wb3-ai-diff wb3-ai-diff-after">
            <ins>{operation.after}</ins>
          </div>
          {operation.reason ? <p className="wb3-ai-reason">{operation.reason}</p> : null}
        </>
      )
    }
    if (operation.op === 'setWeight') {
      return (
        <p className="wb3-ai-weight">
          {operation.before} → {operation.after}
          {operation.reason ? <span> · {operation.reason}</span> : null}
        </p>
      )
    }
    if (operation.op === 'add') {
      return (
        <div className="wb3-ai-diff wb3-ai-diff-after">
          <ins>{operation.block.text}</ins>
        </div>
      )
    }
    return (
      <div className="wb3-ai-diff wb3-ai-diff-before">
        <del>{operation.before}</del>
      </div>
    )
  })()

  const heading =
    operation.op === 'add'
      ? `新增 ${operation.block.label}`
      : operation.op === 'remove'
        ? `删除 ${blockLabel(operation.blockId)}`
        : `${operation.op === 'replace' ? '改写' : '调权重'} ${blockLabel(operation.blockId)}`

  return (
    <article
      className="wb3-ai-operation"
      data-testid="wb3-ai-operation"
      data-state={selected ? 'selected' : 'default'}
    >
      <header className="wb3-ai-operation-head">
        <strong>{heading}</strong>
        <span className="wb3-ai-kind">
          {operation.op === 'replace'
            ? '改写'
            : operation.op === 'setWeight'
              ? '调权重'
              : operation.op === 'add'
                ? '新增'
                : '删除'}
        </span>
        <Button variant={selected ? 'secondary' : 'quiet'} size="sm" disabled={disabled} onClick={onToggle}>
          {selected ? '撤销' : '接收'}
        </Button>
      </header>
      {body}
    </article>
  )
}

export const AiRewriteDialog: React.FC<AiRewriteDialogProps> = ({
  open,
  projectId,
  workspace,
  spec,
  draftRowVersion,
  providers,
  providersLoading,
  providersError,
  initialIntent,
  autoStart,
  initialJob,
  onPrepare,
  onClose,
  onDraftUpdated,
  onJobStarted,
  onJobResolved
}) => {
  const queryClient = useQueryClient()
  const chatProviders = useMemo(
    () => providers.filter((provider) => provider.enabled && provider.kind === 'chat'),
    [providers]
  )
  const [intent, setIntent] = useState(initialIntent)
  const [providerId, setProviderId] = useState(chatProviders[0]?.id ?? '')
  const [activeJob, setActiveJob] = useState<SuggestJob | null>(initialJob)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [localError, setLocalError] = useState<string | null>(null)
  const startedRef = useRef(false)

  useEffect(() => {
    if (!open) return
    setIntent(initialIntent)
    setSelected(new Set())
    setLocalError(null)
  }, [open])

  useEffect(() => {
    if (!open) return
    setActiveJob(initialJob)
  }, [open, initialJob?.jobId])

  useEffect(() => {
    if (!chatProviders.some((provider) => provider.id === providerId)) {
      setProviderId(chatProviders[0]?.id ?? '')
    }
  }, [chatProviders, providerId])

  const jobQuery = useJob(activeJob?.jobId ?? null)
  const job = jobQuery.data ?? null
  const terminal = job ? isTerminalJobStatus(job.status) : false
  const failed = job?.status === 'failed' || job?.status === 'cancelled' || job?.status === 'unknown_outcome'
  const suggestionId =
    terminal && job?.status === 'succeeded' && job.result && typeof job.result === 'object'
      ? (((job.result as { suggestionId?: unknown }).suggestionId as string | undefined) ?? null)
      : null
  const suggestionQuery = useQuery({
    queryKey: queryKeys.suggestion(projectId, suggestionId ?? 'none'),
    queryFn: ({ signal }) => getPromptSuggestion(suggestionId!, signal),
    enabled: Boolean(suggestionId)
  })
  const suggestion = suggestionQuery.data ?? null

  useEffect(() => {
    if (!suggestion || suggestion.status !== 'proposed') return
    setSelected(new Set(suggestion.operations.map((_, index) => index)))
  }, [suggestion?.id, suggestion?.status])

  const startMutation = useMutation({
    mutationFn: async () => {
      if (!providerId) throw new Error('请选择聊天模型连接。')
      if (intent.trim().length === 0) throw new Error('请描述希望修改的地方。')
      await onPrepare()
      if (workspace.activeDraft) {
        return requestPromptSuggestionFromDraft(
          projectId,
          workspace.activeDraft.id,
          providerId,
          intent.trim()
        )
      }
      if (workspace.activePromptVersion) {
        return requestPromptSuggestionFromVersion(workspace.activePromptVersion.id, providerId, intent.trim())
      }
      throw new Error('当前没有可用的提示词版本。')
    },
    onMutate: () => {
      setLocalError(null)
      setSelected(new Set())
    },
    onSuccess: (created) => {
      const next = { kind: 'suggest' as const, jobId: created.jobId }
      setActiveJob(next)
      onJobStarted(next)
    },
    onError: (error) => setLocalError(error instanceof Error ? error.message : String(error))
  })

  useEffect(() => {
    if (!open) {
      startedRef.current = false
      return
    }
    if (!autoStart || startedRef.current) return
    if (providersLoading || providersError) return
    if (chatProviders.length === 0) {
      startedRef.current = true
      return
    }
    if (!providerId || !chatProviders.some((provider) => provider.id === providerId)) return
    if (intent !== initialIntent || intent.trim().length === 0) return
    if (startMutation.isPending) return
    startedRef.current = true
    startMutation.mutate()
  }, [
    open,
    autoStart,
    initialJob?.jobId,
    intent,
    initialIntent,
    providersLoading,
    providersError,
    chatProviders,
    providerId
  ])

  const applyMutation = useMutation({
    mutationFn: async () => {
      if (!suggestion) throw new Error('建议还没有加载完成。')
      return acceptPromptSuggestion(
        suggestion.id,
        draftRowVersion,
        [...selected].sort((left, right) => left - right)
      )
    },
    onSuccess: (result) => {
      onDraftUpdated(result.draft)
      void queryClient.invalidateQueries({ queryKey: queryKeys.workspace(projectId) })
      onJobResolved()
      onClose()
    },
    onError: (error) => setLocalError(error instanceof Error ? error.message : String(error))
  })

  const rejectMutation = useMutation({
    mutationFn: async () => {
      if (!suggestion) throw new Error('建议还没有加载完成。')
      return rejectPromptSuggestion(suggestion.id)
    },
    onSuccess: () => {
      onJobResolved()
      onClose()
    },
    onError: (error) => setLocalError(error instanceof Error ? error.message : String(error))
  })

  const retry = (): void => {
    setActiveJob(null)
    onJobResolved()
    startMutation.mutate()
  }

  const close = (): void => {
    onJobResolved()
    onClose()
  }

  const progress = job?.progress ?? 0
  const noResult = terminal && job?.status === 'succeeded' && !suggestionId
  const needsRetry = failed || noResult
  const jobRunning = activeJob !== null && !terminal && !failed
  const canStart =
    chatProviders.length > 0 &&
    intent.trim().length > 0 &&
    !startMutation.isPending &&
    !providersLoading &&
    !providersError &&
    !jobRunning
  const proposalReady = suggestion?.status === 'proposed'
  const disabledRows = !proposalReady || applyMutation.isPending

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close()
      }}
      title="AI 改写"
      description="说一句要改的地方，AI 会给出逐条改动建议。"
      busy={startMutation.isPending || applyMutation.isPending}
      className="wb3-ai-dialog"
      footer={
        <>
          {suggestion && proposalReady ? (
            <>
              <Button
                variant="quiet"
                disabled={rejectMutation.isPending || applyMutation.isPending}
                onClick={() => rejectMutation.mutate()}
              >
                全部拒绝
              </Button>
              <span className="wb3-dialog-spacer" />
              <Button variant="quiet" disabled={applyMutation.isPending} onClick={close}>
                关闭
              </Button>
              <AsyncButton
                variant="primary"
                busy={applyMutation.isPending}
                busyLabel="应用中…"
                disabled={selected.size === 0}
                onClick={() => applyMutation.mutate()}
              >
                应用已选 {selected.size} 条
              </AsyncButton>
            </>
          ) : (
            <>
              <span className="wb3-dialog-spacer" />
              <Button variant="quiet" disabled={startMutation.isPending} onClick={close}>
                关闭
              </Button>
              <AsyncButton
                variant="primary"
                busy={startMutation.isPending}
                busyLabel="提交任务…"
                disabled={!canStart}
                onClick={needsRetry ? retry : () => startMutation.mutate()}
              >
                {jobRunning ? '生成中…' : needsRetry ? '重试' : '生成建议'}
              </AsyncButton>
            </>
          )}
        </>
      }
    >
      <div className="wb3-dialog-stack">
        {providersError ? (
          <InlineNotice tone="danger">{providersError}</InlineNotice>
        ) : providersLoading ? (
          <InlineNotice tone="info">正在加载模型连接…</InlineNotice>
        ) : chatProviders.length === 0 ? (
          <EmptyState title="没有可用的聊天模型" description="在设置中添加并启用一个聊天连接。" />
        ) : (
          <div className="wb3-ai-form">
            <Field label="改法">
              <TextField
                value={intent}
                maxLength={2000}
                disabled={startMutation.isPending || (activeJob !== null && !needsRetry)}
                placeholder="比如：发色偏冷一点，旗袍纹样讲具体"
                onValueChange={setIntent}
              />
            </Field>
            {chatProviders.length > 1 ? (
              <Field label="聊天模型">
                <Select
                  value={providerId}
                  disabled={startMutation.isPending || (activeJob !== null && !needsRetry)}
                  onValueChange={setProviderId}
                >
                  {chatProviders.map((provider) => (
                    <option key={provider.id} value={provider.id}>
                      {provider.label}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
          </div>
        )}

        {activeJob && !terminal ? (
          <section className="wb3-ai-progress" data-testid="wb3-ai-progress">
            <div className="wb3-ai-progress-head">
              <span>正在生成建议</span>
              <span>{Math.round(Math.min(100, progress))}%</span>
            </div>
            <ProgressBar label="AI 改写进度" value={progress} />
            <ol className="wb3-ai-steps">
              {STEP_LABELS.map((label, index) => {
                const state = stepState(index, progress)
                return (
                  <li key={label} data-state={state}>
                    <span className="wb3-ai-step-dot" aria-hidden="true" />
                    <span>{label}</span>
                    <span className="wb3-ai-step-state">
                      {state === 'done' ? '完成' : state === 'active' ? '进行中' : '等待'}
                    </span>
                  </li>
                )
              })}
            </ol>
          </section>
        ) : null}

        {failed ? (
          <div role="alert">
            <InlineNotice tone="danger">
              模型这次没有返回：{job?.errorMessage ?? job?.errorCode ?? '连接超时'}。没有写入任何改动。
            </InlineNotice>
          </div>
        ) : null}

        {noResult ? (
          <div role="alert">
            <InlineNotice tone="danger">任务结束但没有返回建议，请重试。</InlineNotice>
          </div>
        ) : null}

        {suggestion ? (
          <section className="wb3-ai-suggestions" data-testid="wb3-ai-suggestions">
            <header className="wb3-ai-suggestions-head">
              <strong>{suggestion.intent}</strong>
              <StatusPill
                label={
                  proposalReady
                    ? `已选 ${selected.size} 条 · 剩 ${suggestion.operations.length - selected.size} 条`
                    : '已应用'
                }
                tone={proposalReady ? 'accent' : 'success'}
              />
            </header>
            {suggestion.operations.length === 0 ? (
              <EmptyState compact title="没有可应用的改动" description="换一句更具体的说法再试。" />
            ) : (
              <div className="wb3-ai-operation-list">
                {suggestion.operations.map((operation, index) => (
                  <OperationRow
                    key={`${operation.op}-${index}`}
                    operation={operation}
                    spec={spec}
                    selected={selected.has(index)}
                    disabled={disabledRows}
                    onToggle={() => {
                      setSelected((current) => {
                        const next = new Set(current)
                        if (next.has(index)) next.delete(index)
                        else next.add(index)
                        return next
                      })
                    }}
                  />
                ))}
              </div>
            )}
          </section>
        ) : null}

        {suggestionQuery.isError ? (
          <div role="alert">
            <InlineNotice tone="danger">建议加载失败，请关闭后重试。</InlineNotice>
          </div>
        ) : null}
        {localError ? (
          <div role="alert">
            <InlineNotice tone="danger">{localError}</InlineNotice>
          </div>
        ) : null}
      </div>
    </Dialog>
  )
}
