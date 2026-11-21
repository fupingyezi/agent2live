import React, { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, X } from 'lucide-react'
import type { PromptMaterialRef } from '@agent2live/contracts'
import { PROMPT_REFERENCE_ROLES, type PromptReferenceRole } from '@agent2live/contracts/prompt-reference'
import { uploadAsset } from '@studio/api'
import { ApiError } from '@studio/api'
import { useAssetUrl } from '@studio/hooks'
import {
  Button,
  Field,
  FileDropZone,
  IconButton,
  InlineNotice,
  Select,
  StatusPill,
  Switch,
  TextField
} from '@agent2live/design-system'
import styles from './PromptReferenceEditor.module.scss'

const ROLE_LABELS: Record<PromptReferenceRole, string> = {
  identity_reference: '身份参考',
  style_reference: '风格参考',
  outfit_reference: '服装参考',
  color_reference: '配色参考',
  background_reference: '背景参考',
  pose_reference: '姿态参考',
  sketch: '草图',
  texture: '材质',
  other: '其他'
}

const MAX_REFERENCES = 14

const MAX_FILE_BYTES = 20 * 1024 * 1024

const ACCEPTED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])

interface ReferenceThumbProps {
  assetId: string
  label: string
}

const ReferenceThumb: React.FC<ReferenceThumbProps> = ({ assetId, label }) => {
  const { url, isLoading, error } = useAssetUrl(assetId)
  return (
    <div className={styles['reference-thumb']!}>
      {url ? (
        <img src={url} alt={`${label}预览`} />
      ) : (
        <span>{isLoading ? '…' : error ? '无法加载' : '—'}</span>
      )}
    </div>
  )
}

interface ReferenceRowProps {
  reference: PromptMaterialRef
  index: number
  count: number
  disabled: boolean
  onChange: (patch: Partial<PromptMaterialRef>) => void
  onRemove: () => void
  onMove: (delta: -1 | 1) => void
}

const ReferenceRow: React.FC<ReferenceRowProps> = ({
  reference,
  index,
  count,
  disabled,
  onChange,
  onRemove,
  onMove
}) => {
  const label = `参考 ${index + 1}`
  return (
    <div className={styles['reference-row']!} data-testid="reference-row" data-asset-id={reference.assetId}>
      <ReferenceThumb assetId={reference.assetId} label={label} />
      <div className={styles['reference-row-body']!}>
        <div className={styles['reference-row-heading']!}>
          <strong>{label}</strong>
          {reference.locked ? <StatusPill label="已锁定" tone="warning" /> : null}
        </div>
        <div className={styles['reference-fields']!}>
          <Field label="角色" className={styles['reference-field']!}>
            <Select
              value={reference.role}
              disabled={disabled}
              onValueChange={(value) => onChange({ role: value as PromptReferenceRole })}
            >
              {PROMPT_REFERENCE_ROLES.map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABELS[role]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="权重" className={styles['reference-field']!}>
            <TextField
              type="number"
              min={0.1}
              max={2}
              step={0.1}
              value={reference.weight}
              disabled={disabled}
              onValueChange={(value) => onChange({ weight: Number(value) })}
            />
          </Field>
          <Field label="锁定" className={`${styles['reference-field']!} ${styles['reference-lock']!}`}>
            <Switch
              checked={reference.locked}
              disabled={disabled}
              onCheckedChange={(checked) => onChange({ locked: checked })}
            />
          </Field>
        </div>
        <Field label="备注" className={styles['reference-note']!}>
          <TextField
            value={reference.note}
            maxLength={1000}
            disabled={disabled}
            placeholder="可选"
            onValueChange={(note) => onChange({ note })}
          />
        </Field>
        <div className={styles['reference-row-actions']!}>
          <IconButton
            type="button"
            variant="ghost"
            label="上移参考"
            disabled={disabled || index === 0}
            onClick={() => onMove(-1)}
          >
            <ArrowUp size={16} aria-hidden="true" />
          </IconButton>
          <IconButton
            type="button"
            variant="ghost"
            label="下移参考"
            disabled={disabled || index === count - 1}
            onClick={() => onMove(1)}
          >
            <ArrowDown size={16} aria-hidden="true" />
          </IconButton>
          <IconButton type="button" variant="ghost" label="移除参考" disabled={disabled} onClick={onRemove}>
            <X size={16} aria-hidden="true" />
          </IconButton>
        </div>
      </div>
    </div>
  )
}

export interface PromptReferenceEditorProps {
  references: PromptMaterialRef[]
  disabled?: boolean
  onChange(next: PromptMaterialRef[]): void
}

export const PromptReferenceEditor: React.FC<PromptReferenceEditorProps> = ({
  references,
  disabled = false,
  onChange
}) => {
  const [localError, setLocalError] = useState<string | null>(null)

  const change = (next: PromptMaterialRef[]): void => {
    setLocalError(null)
    try {
      onChange(next)
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : String(error))
    }
  }

  const addMutation = useMutation({
    mutationFn: async (files: File[]) => {
      if (files.length === 0) return []
      if (references.length + files.length > MAX_REFERENCES) {
        throw new Error(`最多 ${MAX_REFERENCES} 张参考图。`)
      }
      const assets = []
      for (const file of files) {
        if (!ACCEPTED_TYPES.has(file.type)) throw new Error(`“${file.name}”不是 PNG/JPEG/WEBP。`)
        if (file.size > MAX_FILE_BYTES) throw new Error(`“${file.name}”超过 20MB。`)
        assets.push(await uploadAsset(file))
      }
      return assets
    },
    onSuccess: (assets) => {
      if (assets.length === 0) return
      change([
        ...references,
        ...assets.map((asset) => ({
          assetId: asset.id,
          role: 'other' as const,
          note: '',
          weight: 1,
          locked: false
        }))
      ])
    },
    onError: (error) =>
      setLocalError(
        error instanceof ApiError ? error.message : error instanceof Error ? error.message : String(error)
      )
  })

  const update = (index: number, patch: Partial<PromptMaterialRef>): void => {
    change(
      references.map((reference, current) => (current === index ? { ...reference, ...patch } : reference))
    )
  }

  const remove = (index: number): void => {
    change(references.filter((_, current) => current !== index))
  }

  const move = (index: number, delta: -1 | 1): void => {
    const target = index + delta
    if (target < 0 || target >= references.length) return
    const next = [...references]
    ;[next[index], next[target]] = [next[target]!, next[index]!]
    change(next)
  }

  const error = localError ?? (addMutation.error ? addMutation.error.message : null)

  return (
    <section className={styles['reference-set-editor']!} data-testid="prompt-reference-editor">
      {references.length > 0 ? (
        <div className={styles['reference-list']!}>
          {references.map((reference, index) => (
            <ReferenceRow
              key={reference.assetId}
              reference={reference}
              index={index}
              count={references.length}
              disabled={disabled || addMutation.isPending}
              onChange={(patch) => update(index, patch)}
              onRemove={() => remove(index)}
              onMove={(delta) => move(index, delta)}
            />
          ))}
        </div>
      ) : null}

      <FileDropZone
        label="添加参考图片"
        accept="image/png,image/jpeg,image/webp"
        multiple
        disabled={disabled || addMutation.isPending || references.length >= MAX_REFERENCES}
        onFiles={(files) => {
          setLocalError(null)
          addMutation.mutate(files)
        }}
      >
        <strong>{addMutation.isPending ? '上传中…' : '添加参考图'}</strong>
        <span>，点击上传图片，或者拖入图片。</span>
      </FileDropZone>

      {error ? (
        <div role="alert">
          <InlineNotice tone="danger">{error}</InlineNotice>
        </div>
      ) : null}
      <InlineNotice tone="info">参考图变化会随提示词保存为新的版本</InlineNotice>
    </section>
  )
}
