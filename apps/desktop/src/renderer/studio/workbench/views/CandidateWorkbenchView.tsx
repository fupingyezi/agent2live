import React, { useState } from 'react'
import type { GenerationDto } from '@studio/api'
import { Button, ConfirmDialog, EmptyState, InlineNotice, ProgressBar } from '@agent2live/design-system'
import { GenerationParamsBar } from '../components/generation/GenerationParamsBar'
import { CandidateGrid } from '../components/generation/CandidateGrid'
import { WorkbenchActionBar } from '../components/WorkbenchActionBar'

export interface CandidateWorkbenchViewProps {
  generation: GenerationDto | null
  promptVersionNumber: number | null
  providerLabel: string
  selectedCandidateId: string | null
  savingCandidateId: string | null
  discarding: boolean
  nextVersionNumber: number
  onSelectCandidate(candidateId: string): void
  onSaveCandidate(candidateId: string): void
  onSaveSelected(): void
  onDiscard(): void
  onRetry(): void
  onRegenerate(): void
  onBackToPrompt(): void
  error: string | null
}

export const CandidateWorkbenchView: React.FC<CandidateWorkbenchViewProps> = ({
  generation,
  promptVersionNumber,
  providerLabel,
  selectedCandidateId,
  savingCandidateId,
  discarding,
  nextVersionNumber,
  onSelectCandidate,
  onSaveCandidate,
  onSaveSelected,
  onDiscard,
  onRetry,
  onRegenerate,
  onBackToPrompt,
  error
}) => {
  const [confirmDiscard, setConfirmDiscard] = useState(false)

  if (!generation) {
    return (
      <div className="wb3-candidate-empty">
        <EmptyState
          title="还没有生成任务"
          description="回到提示词工作台，选择一版提示词后生成图片。"
          action={
            <Button variant="primary" onClick={onBackToPrompt}>
              去提示词工作台
            </Button>
          }
        />
      </div>
    )
  }

  const running = !['succeeded', 'failed', 'cancelled', 'unknown_outcome'].includes(generation.status)
  const failed = ['failed', 'cancelled', 'unknown_outcome'].includes(generation.status)
  const discarded =
    generation.candidates.length > 0 &&
    generation.candidates.every((candidate) => candidate.status === 'rejected')
  const showable = generation.candidates.filter(
    (candidate) => candidate.status === 'ready' || candidate.status === 'accepted'
  )
  const selected =
    showable.find((candidate) => candidate.id === selectedCandidateId && candidate.status === 'ready') ?? null
  const seconds =
    generation.updatedAt && generation.createdAt
      ? Math.max(
          0,
          Math.round(
            (new Date(generation.updatedAt).getTime() - new Date(generation.createdAt).getTime()) / 1000
          )
        )
      : null
  const selectedCount = selected ? 1 : 0

  return (
    <div className="wb3-candidates-view" data-testid="wb3-candidates-view">
      <GenerationParamsBar
        generation={generation}
        promptVersionNumber={promptVersionNumber}
        providerLabel={providerLabel}
        onBackToPrompt={onBackToPrompt}
        onRegenerate={onRegenerate}
      />
      <div className="wb3-candidates-scroll">
        {error ? (
          <div role="alert">
            <InlineNotice tone="danger">{error}</InlineNotice>
          </div>
        ) : null}
        {running ? (
          <div className="wb3-candidates-progress">
            <strong>正在生成 {generation.count} 张候选</strong>
            <ProgressBar
              label="生成进度"
              {...(generation.progress === null ? {} : { value: generation.progress })}
            />
            <div className="wb3-candidate-grid">
              {Array.from({ length: generation.count }, (_, index) => (
                <div key={index} className="wb3-candidate-skeleton" aria-hidden="true" />
              ))}
            </div>
          </div>
        ) : failed ? (
          <EmptyState
            title="这次生成没有完成"
            description={generation.errorMessage ?? generation.errorCode ?? '请调整模型或参数后重试。'}
            action={
              <Button variant="primary" onClick={onRetry}>
                重试
              </Button>
            }
          />
        ) : discarded ? (
          <EmptyState
            title="本批已丢弃"
            description="候选已作废，回到提示词工作台继续调整。"
            action={
              <Button variant="primary" onClick={onBackToPrompt}>
                去提示词工作台
              </Button>
            }
          />
        ) : (
          <CandidateGrid
            candidates={showable}
            requestedCount={generation.count}
            selectedId={selectedCandidateId}
            savingId={savingCandidateId}
            seconds={seconds}
            onSelect={onSelectCandidate}
            onSave={onSaveCandidate}
          />
        )}
      </div>
      <WorkbenchActionBar
        status={
          running
            ? `生成中 · ${generation.progress ?? 0}%`
            : failed
              ? '生成失败'
              : `已选 ${selectedCount} 张 · 存为立绘后成为第 ${nextVersionNumber} 版`
        }
      >
        <Button variant="secondary" disabled={running || discarding} onClick={() => setConfirmDiscard(true)}>
          {discarding ? '丢弃中…' : '丢弃本批'}
        </Button>
        {failed ? (
          <Button variant="primary" onClick={onRetry}>
            重试
          </Button>
        ) : (
          <Button variant="primary" disabled={!selected || running} onClick={onSaveSelected}>
            存为立绘
          </Button>
        )}
      </WorkbenchActionBar>
      <ConfirmDialog
        open={confirmDiscard}
        title="丢弃本批？"
        destructive
        confirmLabel="丢弃"
        busy={discarding}
        onCancel={() => setConfirmDiscard(false)}
        onConfirm={() => {
          setConfirmDiscard(false)
          onDiscard()
        }}
      >
        <p>本批候选会被标记为已丢弃，不会删除历史记录，也不会影响当前立绘版本。</p>
      </ConfirmDialog>
    </div>
  )
}
