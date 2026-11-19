import React, { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { ArtProjectDto } from '@studio/api'
import { updateForkLink } from '@studio/api'
import { queryKeys } from '@studio/api'
import { ApiError } from '@studio/api'
import { shortId } from '@studio/format'
import {
  AsyncButton,
  Button,
  ConfirmDialog,
  Field,
  InlineNotice,
  StatusPill,
  TextField
} from '@agent2live/design-system'
import styles from './ForkOriginBar.module.scss'

export interface ForkOriginBarProps {
  project: ArtProjectDto
}

export const ForkOriginBar: React.FC<ForkOriginBarProps> = ({ project }) => {
  const queryClient = useQueryClient()
  const fork = project.forkedFrom
  const [editing, setEditing] = useState(false)
  const [label, setLabel] = useState(fork?.branchLabel ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDetach, setConfirmDetach] = useState(false)

  if (!fork) return null

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.project(project.id) })
    void queryClient.invalidateQueries({ queryKey: queryKeys.lineages })
    void queryClient.invalidateQueries({ queryKey: queryKeys.characters })
  }

  const rename = (): void => {
    if (!label.trim()) {
      setError('分支标签不能为空。')
      return
    }
    setBusy(true)
    setError(null)
    updateForkLink(project.id, { branchLabel: label.trim() })
      .then(() => {
        setEditing(false)
        invalidate()
      })
      .catch((reason) => setError(reason instanceof ApiError ? reason.message : String(reason)))
      .finally(() => setBusy(false))
  }

  const detach = (): void => {
    setBusy(true)
    setError(null)
    updateForkLink(project.id, { detach: true })
      .then(() => {
        setConfirmDetach(false)
        invalidate()
      })
      .catch((reason) => setError(reason instanceof ApiError ? reason.message : String(reason)))
      .finally(() => setBusy(false))
  }

  return (
    <div className={styles['fork-origin-bar']!} data-testid="fork-origin-bar">
      <StatusPill
        label={fork.status === 'detached' ? '已脱离' : '分支'}
        tone={fork.status === 'detached' ? 'warning' : 'neutral'}
      />
      <span>
        来自 <code title={fork.parentProjectId}>{shortId(fork.parentProjectId)}</code>
        {' · '}
        {fork.sourceKind === 'prompt_version' ? '提示词版本' : '美术版本'}
      </span>
      {editing ? (
        <div className={styles['inline-edit']!}>
          <Field label="分支标签">
            <TextField value={label} maxLength={80} onValueChange={setLabel} />
          </Field>
          <AsyncButton type="button" busy={busy} busyLabel="保存中…" onClick={rename}>
            保存
          </AsyncButton>
          <Button
            type="button"
            variant="quiet"
            size="sm"
            onClick={() => {
              setEditing(false)
              setError(null)
            }}
          >
            取消
          </Button>
        </div>
      ) : (
        <span className={styles['branch-label']!}>
          {fork.branchLabel}
          <Button
            type="button"
            variant="quiet"
            size="sm"
            onClick={() => {
              setLabel(fork.branchLabel)
              setEditing(true)
            }}
          >
            重命名
          </Button>
        </span>
      )}
      {fork.parentDeleted ? <StatusPill label="父项目已删除" tone="warning" /> : null}
      {fork.status === 'active' ? (
        <Button type="button" variant="danger" size="sm" onClick={() => setConfirmDetach(true)}>
          脱离分支
        </Button>
      ) : null}
      {error ? (
        <div role="alert">
          <InlineNotice tone="danger">{error}</InlineNotice>
        </div>
      ) : null}

      <ConfirmDialog
        open={confirmDetach}
        title="脱离父分支？"
        destructive
        confirmLabel="脱离"
        busy={busy}
        onCancel={() => setConfirmDetach(false)}
        onConfirm={() => {
          detach()
        }}
      >
        <p>脱离只改变谱系状态；不会删除历史版本、来源记录，也不会自动合并回父分支。此操作不能从 UI 撤销。</p>
      </ConfirmDialog>
    </div>
  )
}
