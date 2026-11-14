import React, { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { ArtProjectDto, PromptDraftDto, PromptSpecV2 } from '../../api/types'
import { ApiError } from '../../api/client'
import { commitPromptDraft, savePromptDraft } from '../../api/queries'
import { queryKeys } from '../../api/keys'
import { useWorkbenchStore } from '../store'
import { uncoveredRequirementIds, validatePromptForSave } from '../prompt-helpers'
import {
  AsyncButton,
  Button,
  ConfirmDialog,
  Field,
  InlineNotice,
  StatusPill,
  Switch
} from '@agent2live/design-system'

export interface DraftToolbarProps {
  project: ArtProjectDto
  draft: PromptDraftDto | null
  spec: PromptSpecV2
  dirty: boolean
  busy: boolean
  onOpenAi: () => void
  onOpenGeneration: () => void
  onCommitted: (versionId: string) => void
}

function messageOf(error: unknown): string | null {
  if (!error) return null
  return error instanceof ApiError ? error.message : error instanceof Error ? error.message : String(error)
}

export const DraftToolbar: React.FC<DraftToolbarProps> = ({
  project,
  draft,
  spec,
  dirty,
  busy,
  onOpenAi,
  onOpenGeneration,
  onCommitted
}) => {
  const queryClient = useQueryClient()
  const store = useWorkbenchStore()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmCommit, setConfirmCommit] = useState(false)
  const [acknowledge, setAcknowledge] = useState(false)

  const validation = validatePromptForSave(spec)
  const uncovered = uncoveredRequirementIds(spec)
  const canSave = Boolean(draft) && dirty && !validation && !busy && !saving
  const canCommit = Boolean(draft) && spec.blocks.length > 0 && !validation && !busy && !saving

  const save = async (): Promise<PromptDraftDto | null> => {
    if (!draft) return null
    setSaving(true)
    setError(null)
    try {
      const saved = await savePromptDraft(project.id, draft.id, spec, store.rowVersion ?? draft.rowVersion)
      store.markSaved(saved.state, saved.rowVersion, saved.revision)
      void queryClient.invalidateQueries({ queryKey: queryKeys.workspace(project.id) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.project(project.id) })
      return saved
    } catch (reason) {
      setError(messageOf(reason))
      return null
    } finally {
      setSaving(false)
    }
  }

  const commit = async (): Promise<void> => {
    if (!draft) return
    let current = draft
    if (dirty) {
      const saved = await save()
      if (!saved) return
      current = saved
    }
    const expectedRowVersion = store.rowVersion ?? current.rowVersion
    setSaving(true)
    setError(null)
    try {
      const result = await commitPromptDraft(project.id, current.id, expectedRowVersion, true)
      store.reset()
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.workspace(project.id) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.project(project.id) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.promptVersions(project.id) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.lineages }),
        queryClient.invalidateQueries({ queryKey: queryKeys.characters })
      ])
      setConfirmCommit(false)
      setAcknowledge(false)
      onCommitted(result.version.id)
    } catch (reason) {
      setError(messageOf(reason))
      setConfirmCommit(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="draft-toolbar" data-testid="draft-toolbar">
      <div className="draft-status">
        <span className={`dirty-dot${dirty ? ' dirty' : ''}`} aria-hidden="true" />
        <div>
          <strong>{dirty ? '有未保存修改' : draft ? '草稿已保存' : '尚无活动草稿'}</strong>
          <p>
            {draft
              ? `revision ${store.revision ?? draft.revision} · row ${store.rowVersion ?? draft.rowVersion}`
              : '先提交素材与要求，或从当前版本创建草稿'}
          </p>
        </div>
        {uncovered.length > 0 ? (
          <StatusPill label={`${uncovered.length} 条要求未覆盖`} tone="warning" />
        ) : null}
      </div>

      {validation ? (
        <div role="alert">
          <InlineNotice tone="danger">无法保存：{validation}</InlineNotice>
        </div>
      ) : null}
      {error ? (
        <div role="alert">
          <InlineNotice tone="danger">{error}</InlineNotice>
        </div>
      ) : null}

      <div className="toolbar-actions">
        <Button type="button" variant="quiet" onClick={() => store.toggleLockAll()} disabled={!draft || busy}>
          {spec.lockAll ? '解除全锁' : '全锁'}
        </Button>
        <Button
          type="button"
          variant="quiet"
          onClick={() => store.cancelLocalChanges()}
          disabled={!dirty || busy}
        >
          撤销未保存
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={onOpenAi}
          disabled={!draft || dirty || busy}
          title={dirty ? '先保存草稿再调用 AI' : undefined}
        >
          AI 助手
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={onOpenGeneration}
          disabled={!project.activePromptVersionId || dirty || busy}
        >
          生成立绘
        </Button>
        <AsyncButton
          type="button"
          variant="secondary"
          busy={saving}
          busyLabel="保存中…"
          disabled={!canSave}
          onClick={() => {
            void save()
          }}
        >
          保存草稿
        </AsyncButton>
        <AsyncButton
          type="button"
          busy={saving}
          busyLabel="提交中…"
          disabled={!canCommit}
          onClick={() => setConfirmCommit(true)}
        >
          提交版本
        </AsyncButton>
      </div>

      <ConfirmDialog
        open={confirmCommit}
        title="提交为不可变提示词版本？"
        confirmLabel="提交版本"
        busy={saving}
        confirmDisabled={uncovered.length > 0 && !acknowledge}
        onCancel={() => setConfirmCommit(false)}
        onConfirm={() => {
          void commit()
        }}
      >
        <p>提交后会生成新的 PromptVersion 并成为当前版本；草稿将关闭，历史版本不能被修改。</p>
        {uncovered.length > 0 ? (
          <Field
            label={`我知道有 ${uncovered.length} 条必须/避免要求未被覆盖，仍要提交。`}
            className="confirm-ack"
          >
            <Switch checked={acknowledge} onCheckedChange={setAcknowledge} aria-label="确认提交未覆盖要求" />
          </Field>
        ) : null}
      </ConfirmDialog>
    </section>
  )
}
