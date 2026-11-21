import React, { useState } from 'react'
import type { ArtVersionDto, GenerationDto } from '@studio/api'
import { useAssetUrl } from '@studio/hooks'
import { formatDateTime } from '@studio/format'
import { Button, ConfirmDialog, EmptyState, InlineNotice, ProgressBar } from '@agent2live/design-system'
import { StudioLoading } from '@studio/components'
import { GenerationParamsBar } from '../../components/generation/GenerationParamsBar'
import { CandidateGrid } from '../../components/generation/CandidateGrid'
import { WorkbenchActionBar } from '../../components/WorkbenchActionBar'
import styles from './CandidateWorkbenchView.module.scss'

export interface CandidateWorkbenchViewProps {
  generation: GenerationDto | null
  loading: boolean
  promptVersionNumber: number | null
  baseVersionId: string | null
  baseVersion: ArtVersionDto | null
  providerLabel: string
  selectedCandidateId: string | null
  savingCandidateId: string | null
  discarding: boolean
  onSelectCandidate(candidateId: string): void
  onSaveCandidate(candidateId: string): void
  onViewArtVersion(versionId: string): void
  onSaveSelected(): void
  onDiscard(): void
  onRetry(): void
  onRetrySlot(): void
  onRegenerate(): void
  onBackToPrompt(): void
  error: string | null
}

export const CandidateWorkbenchView: React.FC<CandidateWorkbenchViewProps> = ({
  generation,
  loading,
  promptVersionNumber,
  baseVersionId,
  baseVersion,
  providerLabel,
  selectedCandidateId,
  savingCandidateId,
  discarding,
  onSelectCandidate,
  onSaveCandidate,
  onViewArtVersion,
  onSaveSelected,
  onDiscard,
  onRetry,
  onRetrySlot,
  onRegenerate,
  onBackToPrompt,
  error
}) => {
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const { url: baseUrl, isLoading: baseLoading } = useAssetUrl(baseVersion?.artworkAssetId ?? null)
  const hasBase = baseVersionId !== null

  if (loading) {
    return (
      <section className={styles['workbench-loading']!} data-testid="wb3-candidates-loading">
        <StudioLoading label="正在加载生成任务…" />
      </section>
    )
  }

  if (!generation) {
    return (
      <div className={styles['wb3-candidate-empty']!}>
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
    <div className={styles['wb3-candidates-view']!} data-testid="wb3-candidates-view">
      <GenerationParamsBar
        generation={generation}
        promptVersionNumber={promptVersionNumber}
        providerLabel={providerLabel}
        onBackToPrompt={onBackToPrompt}
        onRegenerate={onRegenerate}
      />
      <div className={styles['wb3-candidates-scroll']!}>
        {error ? (
          <div role="alert">
            <InlineNotice tone="danger">{error}</InlineNotice>
          </div>
        ) : null}
        {running ? (
          <div className={styles['wb3-candidates-progress']!}>
            <strong>正在生成 {generation.count} 张候选</strong>
            <ProgressBar
              label="生成进度"
              {...(generation.progress === null ? {} : { value: generation.progress })}
            />
            <div className={styles['wb3-candidate-grid']!}>
              {Array.from({ length: generation.count }, (_, index) => (
                <div key={index} className={styles['wb3-candidate-skeleton']!} aria-hidden="true" />
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
          <div className={styles['wb3-candidate-compare']!}>
            <aside className={styles['wb3-candidate-baseline']!} data-testid="wb3-candidate-baseline">
              <header>
                <strong>{baseVersion ? '当前立绘（本次基线）' : hasBase ? '本次基线' : '首次立绘'}</strong>
                <span>{hasBase ? '旧图只用于本次对比' : '没有旧图可对比'}</span>
              </header>
              <div className={styles['wb3-candidate-baseline-image']!}>
                {!hasBase ? (
                  <span>这次没有旧立绘，直接从提示词生成。</span>
                ) : baseVersion === null ? (
                  <span>本次基线暂时不可用。当前立绘仍保持不变。</span>
                ) : baseLoading ? (
                  <span>加载中…</span>
                ) : baseUrl ? (
                  <img src={baseUrl} alt="本次生成使用的当前立绘基线" />
                ) : (
                  <span>无法加载当前立绘</span>
                )}
              </div>
              <footer>
                {baseVersion ? (
                  <>
                    <strong>第 {baseVersion.versionNumber} 版</strong>
                    <span>{formatDateTime(baseVersion.createdAt)}</span>
                  </>
                ) : hasBase ? (
                  <span>生成批次已固定旧图，正在等待基线信息</span>
                ) : (
                  <span>提示词驱动的新起点</span>
                )}
              </footer>
            </aside>
            <CandidateGrid
              candidates={showable}
              requestedCount={generation.count}
              selectedId={selectedCandidateId}
              savingId={savingCandidateId}
              seconds={seconds}
              onSelect={onSelectCandidate}
              onSave={onSaveCandidate}
              onViewArtVersion={onViewArtVersion}
              onRetrySlot={onRetrySlot}
            />
          </div>
        )}
      </div>
      <WorkbenchActionBar
        status={
          running
            ? `生成中 · ${generation.progress ?? 0}%`
            : failed
              ? '生成失败'
              : selectedCount === 0
                ? '请选择一张候选 · 选中后会替换当前立绘'
                : `已选 ${selectedCount} 张 · 将替换当前立绘`
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
        <p>本批候选会被标记为已丢弃，不会删除历史记录，也不会影响当前立绘。</p>
      </ConfirmDialog>
    </div>
  )
}
