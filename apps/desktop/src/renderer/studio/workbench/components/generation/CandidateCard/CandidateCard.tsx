import React from 'react'
import type { GenerationCandidateDto } from '@studio/api'
import { useAssetUrl } from '@studio/hooks'
import { Button, StatusPill } from '@agent2live/design-system'
import styles from './CandidateCard.module.scss'

export interface CandidateCardProps {
  candidate: GenerationCandidateDto | null
  index: number
  selected: boolean
  accepted: boolean
  saving: boolean
  onSelect(): void
  onSave(): void
  onView(): void
  onRetrySlot(): void
  seconds: number | null
}

export const CandidateCard: React.FC<CandidateCardProps> = ({
  candidate,
  index,
  selected,
  accepted,
  saving,
  onSelect,
  onSave,
  onView,
  onRetrySlot,
  seconds
}) => {
  const { url, isLoading, error } = useAssetUrl(candidate?.assetId ?? null)
  const ready = candidate?.status === 'ready'

  return (
    <article
      className={styles['wb3-candidate-card']!}
      data-testid="wb3-candidate-card"
      data-state={candidate ? (selected ? 'selected' : candidate.status) : 'failed'}
      aria-label={`候选 ${index + 1}`}
    >
      <header className={styles['wb3-candidate-head']!}>
        <strong>候选 {index + 1}</strong>
        {selected ? (
          <StatusPill label="已选" tone="accent" />
        ) : ready ? (
          <Button variant="quiet" size="sm" disabled={saving} onClick={onSave}>
            存为立绘
          </Button>
        ) : accepted ? (
          <>
            <StatusPill label="已存为立绘" tone="success" />
            {candidate?.acceptedArtVersionId ? (
              <Button variant="quiet" size="sm" onClick={onView}>
                查看
              </Button>
            ) : null}
          </>
        ) : null}
      </header>
      <button
        type="button"
        className={styles['wb3-candidate-image']!}
        aria-label={`选择候选 ${index + 1}`}
        aria-pressed={selected}
        disabled={!ready}
        onClick={onSelect}
      >
        {candidate === null ? (
          <span className={styles['wb3-candidate-fail']!}>
            <strong>这张没有生成</strong>
            <span>内容审核未通过或未返回</span>
          </span>
        ) : isLoading ? (
          <span>加载中…</span>
        ) : error || !url ? (
          <span>无法加载</span>
        ) : (
          <img src={url} alt={`候选 ${index + 1}`} />
        )}
      </button>
      <footer className={styles['wb3-candidate-footer']!}>
        {candidate ? (
          <>
            <span>
              {candidate.asset
                ? `${candidate.asset.width ?? '—'} × ${candidate.asset.height ?? '—'}`
                : '尺寸未知'}
            </span>
            <span>{seconds === null ? '—' : `${seconds} 秒`}</span>
          </>
        ) : (
          <>
            <span>1 张失败</span>
            <Button
              variant="quiet"
              size="sm"
              onClick={(event) => {
                event.stopPropagation()
                onRetrySlot()
              }}
            >
              重试这张
            </Button>
          </>
        )}
      </footer>
    </article>
  )
}
