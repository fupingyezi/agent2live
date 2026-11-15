import React, { useState } from 'react'
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
  busy: boolean
  onAccept: (candidate: GenerationCandidateDto) => void
}

const CandidateStage: React.FC<CandidateStageProps> = ({ candidate, busy, onAccept }) => {
  const issues = validationLines(candidate.validation)
  return (
    <article className="candidate-stage" data-testid="candidate-card">
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
        <div>
          <strong>候选</strong>
          <p className="studio-meta">
            {candidate.asset
              ? `${candidate.asset.width ?? '—'} × ${candidate.asset.height ?? '—'}`
              : '图片信息不可用'}{' '}
            · 原图未裁切
          </p>
          {issues.length > 0 ? (
            <ul className="validation-list">
              {issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          ) : (
            <p className="muted">未报告验证问题</p>
          )}
        </div>
        <AsyncButton
          type="button"
          busy={busy}
          busyLabel="接受中…"
          disabled={candidate.status !== 'ready'}
          onClick={() => onAccept(candidate)}
        >
          接受候选
        </AsyncButton>
      </div>
    </article>
  )
}

interface CandidateStripProps {
  candidates: GenerationCandidateDto[]
  selectedId: string
  onSelect: (candidateId: string) => void
}

const CandidateStrip: React.FC<CandidateStripProps> = ({ candidates, selectedId, onSelect }) => (
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
  </aside>
)

export interface CandidateCompareProps {
  candidates: GenerationCandidateDto[]
  acceptingId: string | null
  onAccept: (candidate: GenerationCandidateDto) => void
}

export const CandidateCompare: React.FC<CandidateCompareProps> = ({ candidates, acceptingId, onAccept }) => {
  const [selectedId, setSelectedId] = useState(
    () => candidates.find((candidate) => candidate.status === 'ready')?.id ?? candidates[0]?.id ?? ''
  )
  const [confirming, setConfirming] = useState<GenerationCandidateDto | null>(null)

  if (candidates.length === 0) {
    return <EmptyState compact title="这次生成没有产生候选" description="调整提示词或模型参数后再试。" />
  }
  const selected = candidates.find((candidate) => candidate.id === selectedId) ?? candidates[0]!

  return (
    <section className="candidate-compare" data-testid="candidate-compare">
      <div className="candidate-workbench" data-testid="candidate-stage">
        <CandidateStage
          candidate={selected}
          busy={acceptingId === selected.id}
          onAccept={(candidate) => setConfirming(candidate)}
        />
        <CandidateStrip candidates={candidates} selectedId={selected.id} onSelect={setSelectedId} />
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
