import React, { useEffect, useState } from 'react'
import { PROMPT_CATEGORIES } from '@agent2live/contracts/prompt'
import type { PromptBlock, PromptSpecV2 } from '@studio/api'
import {
  Button,
  ChipGroup,
  ConfirmDialog,
  Dialog,
  Field,
  InlineNotice,
  Switch,
  TextField,
  Textarea
} from '@agent2live/design-system'
import { PROMPT_STRENGTH_LABELS } from '../../../prompt-labels'
import { PROMPT_CATEGORY_LABELS } from '../../../prompt-diagnostics'
import styles from './PromptBlockDialog.module.scss'

const WEIGHT_OPTIONS = [0.8, 1, 1.3, 1.5, 2]

function weightLabel(weight: number): string {
  return Number.isInteger(weight) ? weight.toFixed(1) : String(weight)
}

export interface PromptBlockDialogProps {
  open: boolean
  spec: PromptSpecV2 | null
  block: PromptBlock | null
  negative: boolean
  readOnly: boolean
  saving: boolean
  error: string | null
  onClose(): void
  onSave(block: PromptBlock): void
  onDelete?(blockId: string): void
}

interface ChipFieldProps {
  label: string
  children: React.ReactNode
}

const ChipField: React.FC<ChipFieldProps> = ({ label, children }) => {
  return (
    <div className={styles['wb3-dialog-field']!}>
      <span className={styles['wb3-dialog-field-label']!}>{label}</span>
      {children}
    </div>
  )
}

function newBlock(negative: boolean): PromptBlock {
  return {
    id: `block-${crypto.randomUUID()}`,
    category: negative ? 'negative' : 'subject',
    label: negative ? '新负面条目' : '新提示条目',
    text: '待填写',
    weight: 1,
    locked: false,
    strength: negative ? 'avoid' : 'prefer',
    confidence: 1,
    evidence: [],
    source: 'user',
    priority: 0,
    requirementRefs: [],
    materialRefs: []
  }
}

export const PromptBlockDialog: React.FC<PromptBlockDialogProps> = ({
  open,
  spec,
  block,
  negative,
  readOnly,
  saving,
  error,
  onClose,
  onSave,
  onDelete
}) => {
  const [draft, setDraft] = useState<PromptBlock>(() => block ?? newBlock(negative))
  const [localError, setLocalError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    if (!open) return
    setDraft(block ?? newBlock(negative))
    setLocalError(null)
    setConfirmDelete(false)
  }, [open, block?.id, negative])

  const isNegative = draft.category === 'negative'
  const weightOptions = [...new Set([...WEIGHT_OPTIONS, draft.weight])].sort((left, right) => left - right)
  const disabled = readOnly || saving

  const update = (patch: Partial<PromptBlock>): void => {
    setDraft((current) => {
      const next = { ...current, ...patch }
      if (patch.category !== undefined && patch.category !== current.category) {
        if (next.category === 'negative') next.strength = 'avoid'
        else if (current.category === 'negative') next.strength = 'prefer'
      }
      return next
    })
  }

  const save = (): void => {
    if (draft.label.trim().length === 0) {
      setLocalError('请填写条目名称。')
      return
    }
    if (draft.text.trim().length === 0) {
      setLocalError('请填写条目正文。')
      return
    }
    setLocalError(null)
    onSave({
      ...draft,
      label: draft.label.trim(),
      text: draft.text.trim()
    })
  }

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next && !saving && !confirmDelete) onClose()
        }}
        title={`${block ? '编辑条目' : '新增条目'} ${block ? block.label : ''}`}
        busy={saving}
        className={styles['wb3-block-dialog']!}
        footer={
          <>
            {block && onDelete ? (
              <Button
                variant="danger"
                disabled={disabled || block.locked || (spec?.lockAll ?? false)}
                onClick={() => setConfirmDelete(true)}
              >
                删除条目
              </Button>
            ) : null}
            <span className={styles['wb3-dialog-spacer']!} />
            <Button variant="quiet" disabled={saving} onClick={onClose}>
              取消
            </Button>
            <Button variant="primary" disabled={disabled} onClick={save}>
              {saving ? '保存中…' : '保存草稿'}
            </Button>
          </>
        }
      >
        <div className={styles['wb3-dialog-stack']!}>
          <ChipField label="分类">
            <ChipGroup
              ariaLabel="块分类"
              value={draft.category}
              disabled={disabled || isNegative}
              onValueChange={(value) => update({ category: value as PromptBlock['category'] })}
              options={PROMPT_CATEGORIES.map((category) => ({
                id: category,
                label: PROMPT_CATEGORY_LABELS[category]
              }))}
            />
          </ChipField>
          <Field label="标签">
            <TextField
              value={draft.label}
              maxLength={100}
              disabled={disabled}
              onValueChange={(label) => update({ label })}
            />
          </Field>
          <Field id="wb3-block-text" label="正文">
            <Textarea
              id="wb3-block-text"
              rows={4}
              maxLength={4000}
              value={draft.text}
              disabled={disabled}
              onValueChange={(text) => update({ text })}
            />
            <p className={styles['wb3-dialog-counter']!}>{draft.text.length} / 4000</p>
          </Field>
          <div className={styles['wb3-dialog-inline']!}>
            <ChipField label="权重">
              <ChipGroup
                ariaLabel="块权重"
                value={String(draft.weight)}
                disabled={disabled}
                onValueChange={(value) => update({ weight: Number(value) })}
                options={weightOptions.map((weight) => ({
                  id: String(weight),
                  label: weightLabel(weight)
                }))}
              />
            </ChipField>
            <ChipField label="强度">
              <ChipGroup
                ariaLabel="块强度"
                value={draft.strength ?? 'prefer'}
                disabled={disabled}
                onValueChange={(value) => update({ strength: value as PromptBlock['strength'] })}
                options={
                  isNegative
                    ? [{ id: 'avoid', label: PROMPT_STRENGTH_LABELS.avoid }]
                    : [
                        { id: 'must', label: PROMPT_STRENGTH_LABELS.must },
                        { id: 'prefer', label: PROMPT_STRENGTH_LABELS.prefer }
                      ]
                }
              />
            </ChipField>
          </div>
          <Field label="锁定" description="锁定后AI不可改写">
            <Switch
              checked={draft.locked}
              disabled={disabled}
              onCheckedChange={(checked) => update({ locked: checked })}
            />
          </Field>
          {localError ? (
            <div role="alert">
              <InlineNotice tone="danger">{localError}</InlineNotice>
            </div>
          ) : null}
          {error ? (
            <div role="alert">
              <InlineNotice tone="danger">{error}</InlineNotice>
            </div>
          ) : null}
        </div>
      </Dialog>
      <ConfirmDialog
        open={confirmDelete}
        title="删除这个提示词块？"
        destructive
        confirmLabel="删除"
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          setConfirmDelete(false)
          if (block && onDelete) onDelete(block.id)
        }}
      ></ConfirmDialog>
    </>
  )
}
