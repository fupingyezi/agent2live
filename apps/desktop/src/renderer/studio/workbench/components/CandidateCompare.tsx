import React, { useEffect, useRef, useState } from 'react'
import type { GenerationCandidateDto } from '@studio/api'
import { useAssetUrl } from '@studio/hooks'
import { AsyncButton, ConfirmDialog, EmptyState, StatusPill } from '@agent2live/design-system'

function validationLines(value: unknown): string[] {
  if (!value || typeof value !== 'object') return []
  const record = value as Record<string, unknown>
  const lines: string[] = []
  for (const key of ['warnings', 'errors', 'issues'] as const) {
    const raw = record[key]
    if (!Array.isArray(raw)) continue
    for (const item of raw) {
      if (typeof item === 'string') lines.push(item)
      else if (
        item &&
        typeof item === 'object' &&
        typeof (item as { message?: unknown }).message === 'string'
      ) {
        lines.push((item as { message: string }).message)
      }
    }
  }
  return lines.slice(0, 8)
}

interface CandidateImageProps {
  assetId: string
  alt: string
}

const CandidateImage: React.FC<CandidateImageProps> = ({ assetId, alt }) => {
  const { url, isLoading, error } = useAssetUrl(assetId)
  return url ? <img src={url} alt={alt} /> : <span>{isLoading ? '加载中…' : error ? '无法加载' : '—'}</span>
}

interface CandidateStageProps {
  candidate: GenerationCandidateDto
  index: number
}

const CandidateStage: React.FC<CandidateStageProps> = ({ candidate, index }) => {
  const issues = validationLines(candidate.validation)
  return (
    <article className="candidate-stage" data-testid="candidate-card">
      <header className="candidate-stage-header">
        <strong>候选 {String.fromCharCode(65 + index)}</strong>
        <span>刚刚</span>
      </header>
      <div className="candidate-stage-image">
        <CandidateImage assetId={candidate.assetId} alt="生成候选" />
        <StatusPill
          label={
            candidate.status === 'ready'
              ? '候选'
              : candidate.status === 'accepted'
                ? '已接受'
                : candidate.status === 'rejected'
                  ? '已拒绝'
                  : '已过期'
          }
          tone={
            candidate.status === 'ready' ? 'accent' : candidate.status === 'accepted' ? 'success' : 'neutral'
          }
        />
      </div>
      <div className="candidate-stage-footer">
        <span>
          {candidate.asset
            ? `${candidate.asset.width ?? '—'} × ${candidate.asset.height ?? '—'}`
            : '图片信息不可用'}
        </span>
        <span>原图未裁切</span>
        {issues.length > 0 ? (
          <ul className="validation-list" hidden>
            {issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </article>
  )
}

interface CandidateStripProps {
  candidates: GenerationCandidateDto[]
  selectedId: string
  onSelect: (candidateId: string) => void
  acceptingId: string | null
  onAccept: (candidate: GenerationCandidateDto) => void
}

const CandidateStrip: React.FC<CandidateStripProps> = ({
  candidates,
  selectedId,
  onSelect,
  acceptingId,
  onAccept
}) => {
  const selected = candidates.find((candidate) => candidate.id === selectedId) ?? candidates[0]!
  return (
    <aside className="candidate-strip" data-testid="candidate-strip">
      <div className="candidate-strip-heading">
        <strong>候选清单</strong>
        <span className="studio-meta">{candidates.length} 张</span>
      </div>
      <div className="candidate-thumbnails">
        {candidates.map((candidate, index) => (
          <button
            key={candidate.id}
            type="button"
            className="candidate-thumbnail"
            aria-label={`查看候选 ${index + 1}`}
            aria-pressed={selectedId === candidate.id}
            data-state={selectedId === candidate.id ? 'active' : 'default'}
            onClick={() => onSelect(candidate.id)}
          >
            <CandidateImage assetId={candidate.assetId} alt={`候选 ${index + 1} 缩略图`} />
            <span>{String.fromCharCode(65 + index)}</span>
          </button>
        ))}
      </div>
      <div className="candidate-strip-footer">
        <AsyncButton
          type="button"
          busy={acceptingId === selected.id}
          busyLabel="设置中…"
          disabled={selected.status !== 'ready'}
          onClick={() => onAccept(selected)}
        >
          设置为立绘
        </AsyncButton>
      </div>
    </aside>
  )
}

export interface CandidateCompareProps {
  candidates: GenerationCandidateDto[]
  acceptingId: string | null
  onAccept: (candidate: GenerationCandidateDto) => void
}

export const CandidateCompare: React.FC<CandidateCompareProps> = ({ candidates, acceptingId, onAccept }) => {
  const orderedCandidates = [...candidates].sort(
    (left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)
  )
  const [selectedId, setSelectedId] = useState(() => orderedCandidates[0]?.id ?? '')
  const [confirming, setConfirming] = useState<GenerationCandidateDto | null>(null)
  const userSelected = useRef(false)
  const candidateSignature = orderedCandidates.map((candidate) => candidate.id).join(':')

  useEffect(() => {
    if (!userSelected.current) setSelectedId(orderedCandidates[0]?.id ?? '')
  }, [candidateSignature])

  if (orderedCandidates.length === 0) {
    return <EmptyState compact title="这次生成没有产生候选" description="调整提示词或模型参数后再试。" />
  }
  const selected = orderedCandidates.find((candidate) => candidate.id === selectedId) ?? orderedCandidates[0]!
  const selectedIndex = orderedCandidates.findIndex((candidate) => candidate.id === selected.id)

  return (
    <section className="candidate-compare" data-testid="candidate-compare">
      <div className="candidate-workbench" data-testid="candidate-stage">
        <CandidateStage candidate={selected} index={selectedIndex} />
        <CandidateStrip
          candidates={orderedCandidates}
          selectedId={selected.id}
          onSelect={(candidateId) => {
            userSelected.current = true
            setSelectedId(candidateId)
          }}
          acceptingId={acceptingId}
          onAccept={(candidate) => setConfirming(candidate)}
        />
      </div>

      <ConfirmDialog
        open={confirming !== null}
        title="接受这个候选并切换当前美术版本？"
        confirmLabel="接受"
        busy={acceptingId !== null}
        onCancel={() => setConfirming(null)}
        onConfirm={() => {
          if (!confirming) return
          onAccept(confirming)
          setConfirming(null)
        }}
      >
        <p>
          接受会创建一个新的不可变 ArtVersion，并把它设为当前参考。若期间当前版本已被其他人改变，请求会以 409
          失败，不会覆盖。
        </p>
      </ConfirmDialog>
    </section>
  )
}
