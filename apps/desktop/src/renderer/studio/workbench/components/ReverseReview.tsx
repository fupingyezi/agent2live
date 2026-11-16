import React, { useState } from 'react'
import type { PromptDraftDto, PromptReverseResultDto } from '@studio/api'
import { applyPromptReverseResult, discardPromptReverseResult } from '@studio/api'
import { AsyncButton, ConfirmDialog, EmptyState, SectionHeader, StatusPill } from '@agent2live/design-system'
import { StudioError } from '@studio/components'
import { formatDateTime } from '@studio/format'

const STATUS_LABELS = { ready: '待应用', applied: '已应用', discarded: '已丢弃' } as const

export interface ReverseReviewProps {
  result: PromptReverseResultDto
  activeDraftRowVersion: number | null
  disabled?: boolean
  onResolved: (draft: PromptDraftDto | null) => void
}

export const ReverseReview: React.FC<ReverseReviewProps> = ({
  result,
  activeDraftRowVersion,
  disabled = false,
  onResolved
}) => {
  const [confirmApply, setConfirmApply] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [discarding, setDiscarding] = useState(false)

  if (error) {
    return <StudioError error={error} onRetry={() => setError(null)} />
  }

  const canApply =
    result.status === 'ready' && activeDraftRowVersion !== null && Boolean(result.state) && !disabled

  return (
    <section className="ai-review" data-testid="reverse-review">
      <SectionHeader
        title="从素材生成提示词"
        description="反推候选"
        actions={
          <StatusPill
            label={STATUS_LABELS[result.status]}
            tone={result.status === 'ready' ? 'accent' : result.status === 'applied' ? 'success' : 'neutral'}
          />
        }
      />

      <p className="muted">
        基准版本 revision {result.baseDraftRevision}，生成于 {formatDateTime(result.createdAt)}。
        应用时会更新当前编辑内容；已锁定块保持原样。
      </p>

      {result.state ? (
        <div className="review-block-list">
          {[...result.state.blocks, ...result.state.negativeBlocks].map((block) => (
            <article className="review-block" key={block.id}>
              <div>
                <strong>{block.label}</strong>
                <span className="muted"> · {block.category}</span>
                {block.locked ? <StatusPill label="锁定" tone="warning" /> : null}
              </div>
              <p>{block.text}</p>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState compact title="结果状态不可用" description="重新请求反推，或丢弃这条结果。" />
      )}

      <div className="form-actions">
        {result.status === 'ready' ? (
          <AsyncButton
            type="button"
            variant="secondary"
            busy={discarding}
            busyLabel="丢弃中…"
            disabled={disabled}
            onClick={() => {
              setDiscarding(true)
              setError(null)
              discardPromptReverseResult(result.id)
                .then(() => onResolved(null))
                .catch(setError)
                .finally(() => setDiscarding(false))
            }}
          >
            丢弃结果
          </AsyncButton>
        ) : null}
        <AsyncButton
          type="button"
          busy={busy}
          busyLabel="应用中…"
          disabled={!canApply}
          onClick={() => setConfirmApply(true)}
        >
          应用修改
        </AsyncButton>
      </div>
      {!activeDraftRowVersion && result.status === 'ready' ? (
        <p className="muted">当前版本暂不可编辑，无法应用反推结果。</p>
      ) : null}

      <ConfirmDialog
        open={confirmApply}
        title="应用反推结果？"
        confirmLabel="应用"
        busy={busy}
        onCancel={() => setConfirmApply(false)}
        onConfirm={() => {
          if (activeDraftRowVersion === null) return
          setBusy(true)
          setError(null)
          applyPromptReverseResult(result.id, activeDraftRowVersion)
            .then((response) => {
              setConfirmApply(false)
              onResolved(response.draft)
            })
            .catch((reason) => {
              setConfirmApply(false)
              setError(reason)
            })
            .finally(() => setBusy(false))
        }}
      >
        <p>当前编辑内容会被替换；未保存的本地修改必须先保存或撤销，应用后不能自动回滚。</p>
      </ConfirmDialog>
    </section>
  )
}
