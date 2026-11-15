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

interface CandidateCardProps {
  candidate: GenerationCandidateDto
  busy: boolean
  onAccept: (candidate: GenerationCandidateDto) => void
}

const CandidateCard: React.FC<CandidateCardProps> = ({ candidate, busy, onAccept }) => {
  const { url, isLoading, error } = useAssetUrl(candidate.assetId)
  const issues = validationLines(candidate.validation)
  return (
    <figure className={`candidate-card candidate-${candidate.status}`} data-testid="candidate-card">
      <div className="candidate-image">
        {url ? (
          <img src={url} alt="生成候选" />
        ) : (
          <span>{isLoading ? '加载中…' : error ? '无法加载' : '—'}</span>
        )}
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
      <figcaption>
        <code title={candidate.id}>{candidate.id}</code>
        {issues.length > 0 ? (
          <ul className="validation-list">
            {issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        ) : (
          <p className="muted">未报告验证问题</p>
        )}
        {candidate.acceptedArtVersionId ? (
          <p className="muted">已接受为 {candidate.acceptedArtVersionId}</p>
        ) : null}
        <AsyncButton
          type="button"
          busy={busy}
          busyLabel="接受中…"
          disabled={candidate.status !== 'ready'}
          onClick={() => onAccept(candidate)}
        >
          接受候选
        </AsyncButton>
      </figcaption>
    </figure>
  )
}

export interface CandidateCompareProps {
  candidates: GenerationCandidateDto[]
  acceptingId: string | null
  onAccept: (candidate: GenerationCandidateDto) => void
}

export const CandidateCompare: React.FC<CandidateCompareProps> = ({ candidates, acceptingId, onAccept }) => {
  const [confirming, setConfirming] = useState<GenerationCandidateDto | null>(null)

  if (candidates.length === 0) {
    return <EmptyState compact title="这次生成没有产生候选" description="调整提示词或模型参数后再试。" />
  }

  return (
    <section className="candidate-compare" data-testid="candidate-compare">
      <div className="candidate-grid">
        {candidates.map((candidate) => (
          <CandidateCard
            key={candidate.id}
            candidate={candidate}
            busy={acceptingId === candidate.id}
            onAccept={(selected) => setConfirming(selected)}
          />
        ))}
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
