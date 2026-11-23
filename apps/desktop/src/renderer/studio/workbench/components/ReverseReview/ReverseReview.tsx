import React, { useEffect, useMemo, useState } from 'react'
import type { PromptDraftDto, PromptReverseResultDto } from '@studio/api'
import { applyPromptReverseResult, discardPromptReverseResult } from '@studio/api'
import {
  AsyncButton,
  Button,
  ConfirmDialog,
  EmptyState,
  SectionHeader,
  StatusPill
} from '@agent2live/design-system'
import { StudioError } from '@studio/components'
import { formatDateTime } from '@studio/format'
import styles from './ReverseReview.module.scss'

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
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const selectableBlocks = useMemo(
    () =>
      result.state
        ? [...result.state.blocks, ...result.state.negativeBlocks].filter((block) => !block.locked)
        : [],
    [result.state]
  )

  useEffect(() => {
    if (result.status !== 'ready') {
      setSelected(new Set())
      return
    }
    setSelected(new Set(selectableBlocks.map((block) => block.id)))
  }, [result.id, result.status, selectableBlocks])

  if (error) {
    return <StudioError error={error} onRetry={() => setError(null)} />
  }

  const proposalReady = result.status === 'ready'
  const canApply =
    proposalReady && activeDraftRowVersion !== null && Boolean(result.state) && !disabled && selected.size > 0

  return (
    <section className={styles['ai-review']!} data-testid="reverse-review">
      <SectionHeader
        title="从素材生成提示词"
        description={
          proposalReady ? `反推候选 · 已接收 ${selected.size} / ${selectableBlocks.length} 块` : '反推候选'
        }
        actions={
          <StatusPill
            label={STATUS_LABELS[result.status]}
            tone={result.status === 'ready' ? 'accent' : result.status === 'applied' ? 'success' : 'neutral'}
          />
        }
      />

      <p className="muted">
        {`基准版本 revision ${result.baseDraftRevision}，生成于 ${formatDateTime(result.createdAt)}。应用时只更新已接收的块；未接收的块和已锁定块保持原样。`}
      </p>

      {result.state ? (
        <div className={styles['review-block-list']!}>
          {[...result.state.blocks, ...result.state.negativeBlocks].map((block) => (
            <article
              className={styles['review-block']!}
              key={block.id}
              data-received={block.locked ? undefined : selected.has(block.id) ? 'true' : 'false'}
            >
              <div className={styles['review-block-head']!}>
                <div>
                  <strong>{block.label}</strong>
                  <span className="muted"> · {block.category}</span>
                  {block.locked ? <StatusPill label="锁定" tone="warning" /> : null}
                </div>
                {block.locked ? null : (
                  <Button
                    variant="quiet"
                    size="sm"
                    data-testid="reverse-block-toggle"
                    disabled={!proposalReady || disabled}
                    onClick={() => {
                      setSelected((current) => {
                        const next = new Set(current)
                        if (next.has(block.id)) next.delete(block.id)
                        else next.add(block.id)
                        return next
                      })
                    }}
                  >
                    {selected.has(block.id) ? '撤销' : '接收'}
                  </Button>
                )}
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
          data-testid="reverse-apply"
          onClick={() => setConfirmApply(true)}
        >
          {proposalReady ? `应用已选 ${selected.size} 块` : STATUS_LABELS[result.status]}
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
          if (activeDraftRowVersion === null || selected.size === 0) return
          setBusy(true)
          setError(null)
          applyPromptReverseResult(result.id, activeDraftRowVersion, [...selected])
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
        <p>
          只应用已接收的 {selected.size} 个块；未接收的块和当前草稿中的其他内容保持不变。应用后不能自动回滚。
        </p>
      </ConfirmDialog>
    </section>
  )
}
