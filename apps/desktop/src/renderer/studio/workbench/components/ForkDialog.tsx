import React, { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { ArtProjectDto } from '@studio/api'
import { createForkFromArtVersion, createForkFromPromptVersion } from '@studio/api'
import { queryKeys } from '@studio/api'
import { ApiError } from '@studio/api'
import {
  AsyncButton,
  ConfirmDialog,
  Field,
  InlineNotice,
  TextField,
  Textarea
} from '@agent2live/design-system'

export interface ForkSource {
  kind: 'prompt_version' | 'art_version'
  versionId: string
  versionLabel: string
}

export interface ForkDialogProps {
  open: boolean
  project: ArtProjectDto
  source: ForkSource | null
  onClose: () => void
  onCreated: (child: ArtProjectDto) => void
}

export const ForkDialog: React.FC<ForkDialogProps> = ({ open, project, source, onClose, onCreated }) => {
  const queryClient = useQueryClient()
  const [title, setTitle] = useState('')
  const [branchLabel, setBranchLabel] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setTitle(`${project.title} · 分支`)
    setBranchLabel('')
    setDescription('')
    setError(null)
    setBusy(false)
  }, [open, project.id, project.title])

  const submit = async (): Promise<void> => {
    if (!source) return
    const cleanTitle = title.trim()
    const cleanBranch = branchLabel.trim()
    if (!cleanTitle) {
      setError('分支标题不能为空。')
      return
    }
    if (!cleanBranch) {
      setError('分支标签不能为空。')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const input = {
        title: cleanTitle,
        branchLabel: cleanBranch,
        ...(description.trim() ? { description: description.trim() } : {})
      }
      const result =
        source.kind === 'prompt_version'
          ? await createForkFromPromptVersion(source.versionId, input)
          : await createForkFromArtVersion(source.versionId, input)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.lineages }),
        queryClient.invalidateQueries({ queryKey: queryKeys.characters }),
        queryClient.invalidateQueries({ queryKey: queryKeys.projects })
      ])
      onCreated(result.childProject)
    } catch (reason) {
      setError(
        reason instanceof ApiError
          ? reason.message
          : reason instanceof Error
            ? reason.message
            : String(reason)
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <ConfirmDialog
      open={open}
      title="从已提交版本创建分支"
      confirmLabel="创建分支"
      busy={busy}
      confirmDisabled={!title.trim() || !branchLabel.trim() || !source}
      onCancel={onClose}
      onConfirm={() => {
        void submit()
      }}
    >
      {source ? (
        <p className="muted">
          源：{source.versionLabel} · <code>{source.versionId}</code>
        </p>
      ) : null}
      <Field label="新分支标题">
        <TextField value={title} maxLength={120} onValueChange={setTitle} />
      </Field>
      <Field label="分支标签" description="同一角色下必须唯一">
        <TextField
          value={branchLabel}
          maxLength={80}
          placeholder="例如：冬季制服"
          onValueChange={setBranchLabel}
        />
      </Field>
      <Field label="描述" description="可选">
        <Textarea rows={3} maxLength={4000} value={description} onValueChange={setDescription} />
      </Field>
      {error ? (
        <div role="alert">
          <InlineNotice tone="danger">{error}</InlineNotice>
        </div>
      ) : null}
      <InlineNotice tone="info">
        Fork 只复制已提交版本，不复制草稿；之后的修改不会自动合并回父分支。
      </InlineNotice>
    </ConfirmDialog>
  )
}
