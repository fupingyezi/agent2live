import React, { useState } from 'react'
import type { PromptDraftDto, PromptOperation, PromptSuggestionDto } from '@studio/api'
import { acceptPromptSuggestion, rejectPromptSuggestion } from '@studio/api'
import { AsyncButton, EmptyState, InlineNotice, SectionHeader, StatusPill } from '@agent2live/design-system'
import { StudioError } from '@studio/components'
import { formatDateTime } from '@studio/format'

interface OperationRowProps {
  operation: PromptOperation
}

const OperationRow: React.FC<OperationRowProps> = ({ operation }) => {
  if (operation.op === 'replace') {
    return (
      <li>
        <strong>改写 {operation.blockId}</strong>
        <div className="diff-line diff-before">
          <del>{operation.before}</del>
        </div>
        <div className="diff-line diff-after">
          <ins>{operation.after}</ins>
        </div>
        {operation.reason ? <p className="muted">{operation.reason}</p> : null}
      </li>
    )
  }
  if (operation.op === 'setWeight') {
    return (
      <li>
        <strong>调整权重 {operation.blockId}</strong>
        <span className="muted">
          {' '}
          {operation.before} → {operation.after}
        </span>
        {operation.reason ? <p className="muted">{operation.reason}</p> : null}
      </li>
    )
  }
  if (operation.op === 'add') {
    return (
      <li>
        <strong>新增块 {operation.block.label}</strong>
        <div className="diff-line diff-after">
          <ins>{operation.block.text}</ins>
        </div>
      </li>
    )
  }
  return (
    <li>
      <strong>删除块 {operation.blockId}</strong>
      <div className="diff-line diff-before">
        <del>{operation.before}</del>
      </div>
      {operation.reason ? <p className="muted">{operation.reason}</p> : null}
    </li>
  )
}

const STATUS_LABELS = {
  proposed: '待处理',
  accepted: '已接受',
  rejected: '已拒绝',
  stale: '已过期'
} as const

export interface SuggestionDiffProps {
  suggestion: PromptSuggestionDto
  activeDraftRowVersion: number | null
  disabled?: boolean
  onResolved: (draft: PromptDraftDto | null) => void
}

export const SuggestionDiff: React.FC<SuggestionDiffProps> = ({
  suggestion,
  activeDraftRowVersion,
  disabled = false,
  onResolved
}) => {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)

  if (error) {
    return <StudioError error={error} onRetry={() => setError(null)} />
  }

  const needsDraft = suggestion.baseKind === 'prompt_draft'
  const canAccept =
    suggestion.status === 'proposed' && !disabled && !(needsDraft && activeDraftRowVersion === null)

  return (
    <section className="ai-review" data-testid="suggestion-diff">
      <SectionHeader
        title={suggestion.intent}
        description="AI 建议"
        actions={
          <StatusPill
            label={STATUS_LABELS[suggestion.status]}
            tone={
              suggestion.status === 'proposed'
                ? 'accent'
                : suggestion.status === 'stale'
                  ? 'warning'
                  : 'neutral'
            }
          />
        }
      />
      <p className="muted">
        基准：
        {suggestion.baseKind === 'prompt_draft'
          ? `当前编辑 revision ${suggestion.baseDraftRevision}`
          : '提示词版本'}{' '}
        · {formatDateTime(suggestion.createdAt)}
      </p>

      {suggestion.operations.length === 0 ? (
        <EmptyState compact title="没有操作" description="这条建议没有产生可应用的变更。" />
      ) : (
        <ul className="operation-list">
          {suggestion.operations.map((operation, index) => (
            <OperationRow key={`${operation.op}-${index}`} operation={operation} />
          ))}
        </ul>
      )}

      {suggestion.warnings.length > 0 ? (
        <InlineNotice tone="warning">
          <strong>建议包含提示</strong>
          <ul>
            {suggestion.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </InlineNotice>
      ) : null}

      {suggestion.status === 'proposed' ? (
        <div className="form-actions">
          <AsyncButton
            type="button"
            variant="secondary"
            busy={busy}
            busyLabel="拒绝中…"
            disabled={disabled}
            onClick={() => {
              setBusy(true)
              setError(null)
              rejectPromptSuggestion(suggestion.id)
                .then(() => onResolved(null))
                .catch(setError)
                .finally(() => setBusy(false))
            }}
          >
            拒绝
          </AsyncButton>
          <AsyncButton
            type="button"
            busy={busy}
            busyLabel="接受中…"
            disabled={!canAccept}
            onClick={() => {
              setBusy(true)
              setError(null)
              acceptPromptSuggestion(suggestion.id, activeDraftRowVersion)
                .then((response) => onResolved(response.draft))
                .catch(setError)
                .finally(() => setBusy(false))
            }}
          >
            接受建议
          </AsyncButton>
        </div>
      ) : null}
      {needsDraft && activeDraftRowVersion === null && suggestion.status === 'proposed' ? (
        <p className="muted">当前版本暂不可编辑，暂时不能接受这条建议。</p>
      ) : null}
    </section>
  )
}
