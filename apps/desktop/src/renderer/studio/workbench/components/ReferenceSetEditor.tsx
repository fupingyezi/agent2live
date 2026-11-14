import React, { useEffect, useMemo, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import {
  ART_VERSION_REFERENCE_ROLES,
  type ArtVersionReferenceRole
} from '@agent2live/contracts/art-reference'
import type { ArtProjectDto, ArtVersionDto, ArtVersionMutationDto } from '../../api/types'
import { reviseArtVersionReferences, uploadAsset, type ArtVersionReferenceInput } from '../../api/queries'
import { ApiError } from '../../api/client'
import { useAssetUrl } from '../../hooks/useAssetUrl'
import {
  AsyncButton,
  Button,
  Field,
  FileDropZone,
  IconButton,
  InlineNotice,
  SectionHeader,
  Select,
  StatusPill,
  Switch,
  TextField
} from '@agent2live/design-system'

const ROLE_LABELS: Record<ArtVersionReferenceRole, string> = {
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

type RevisionReason = 'add' | 'remove' | 'reorder' | 'metadata' | 'switch_primary'

interface ReferenceDraft {
  key: string
  assetId: string
  role: ArtVersionReferenceRole
  note: string
  weight: number
  locked: boolean
  isPrimary: boolean
}

function makeKey(): string {
  return crypto.randomUUID()
}

function toDraft(reference: ArtVersionDto['references'][number]): ReferenceDraft {
  return {
    key: makeKey(),
    assetId: reference.assetId,
    role: reference.role,
    note: reference.note,
    weight: reference.weight,
    locked: reference.locked,
    isPrimary: reference.isPrimary
  }
}

function normalize(references: ReferenceDraft[]): ArtVersionReferenceInput[] {
  const primary = references.find((reference) => reference.isPrimary) ?? references[0]
  if (!primary) return []
  const ordered = [primary, ...references.filter((reference) => reference.key !== primary.key)]
  return ordered.map((reference, index) => ({
    assetId: reference.assetId,
    role: reference.role,
    note: reference.note.trim(),
    weight: Number(reference.weight),
    sortOrder: index,
    isPrimary: index === 0,
    locked: reference.locked
  }))
}

function baseline(version: ArtVersionDto): ArtVersionReferenceInput[] {
  return [...version.references]
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .map((reference) => ({
      assetId: reference.assetId,
      role: reference.role,
      note: reference.note.trim(),
      weight: reference.weight,
      sortOrder: reference.sortOrder,
      isPrimary: reference.isPrimary,
      locked: reference.locked
    }))
}

function serialize(references: ArtVersionReferenceInput[]): string {
  return JSON.stringify(references)
}

function inferReason(before: ArtVersionReferenceInput[], after: ArtVersionReferenceInput[]): RevisionReason {
  const beforeAssets = new Set(before.map((reference) => reference.assetId))
  const afterAssets = new Set(after.map((reference) => reference.assetId))
  if (after.some((reference) => !beforeAssets.has(reference.assetId))) return 'add'
  if (before.some((reference) => !afterAssets.has(reference.assetId))) return 'remove'
  const beforePrimary = before.find((reference) => reference.isPrimary)?.assetId
  const afterPrimary = after.find((reference) => reference.isPrimary)?.assetId
  if (beforePrimary !== afterPrimary) return 'switch_primary'
  const order = (references: ArtVersionReferenceInput[]): string =>
    references
      .filter((reference) => !reference.isPrimary)
      .map((reference) => reference.assetId)
      .join(',')
  if (order(before) !== order(after)) return 'reorder'
  return 'metadata'
}

interface ReferenceThumbProps {
  assetId: string
  label: string
}

const ReferenceThumb: React.FC<ReferenceThumbProps> = ({ assetId, label }) => {
  const { url, isLoading, error } = useAssetUrl(assetId)
  return (
    <div className="reference-thumb">
      {url ? (
        <img src={url} alt={`${label}预览`} />
      ) : (
        <span>{isLoading ? '…' : error ? '无法加载' : '—'}</span>
      )}
    </div>
  )
}

interface ReferenceRowProps {
  reference: ReferenceDraft
  index: number
  auxiliaryIndex: number | null
  auxiliaryCount: number
  disabled: boolean
  canRemove: boolean
  onChange: (patch: Partial<ReferenceDraft>) => void
  onRemove: () => void
  onSetPrimary: () => void
  onMove: (delta: -1 | 1) => void
}

const ReferenceRow: React.FC<ReferenceRowProps> = ({
  reference,
  index,
  auxiliaryIndex,
  auxiliaryCount,
  disabled,
  canRemove,
  onChange,
  onRemove,
  onSetPrimary,
  onMove
}) => {
  const label = reference.isPrimary
    ? `主参考 ${index + 1}`
    : `辅助参考 ${auxiliaryIndex === null ? index + 1 : auxiliaryIndex + 1}`
  return (
    <div className="reference-row" data-testid="reference-row" data-asset-id={reference.assetId}>
      <ReferenceThumb assetId={reference.assetId} label={label} />
      <div className="reference-row-body">
        <div className="reference-row-heading">
          <strong>{label}</strong>
          {reference.isPrimary ? <StatusPill label="主参考" tone="accent" /> : null}
          {reference.locked ? <StatusPill label="已锁定" tone="warning" /> : null}
        </div>
        <div className="reference-fields">
          <Field label="角色" className="reference-field">
            <Select
              value={reference.role}
              disabled={disabled}
              onValueChange={(value) => onChange({ role: value as ArtVersionReferenceRole })}
            >
              {ART_VERSION_REFERENCE_ROLES.map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABELS[role]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="权重" className="reference-field">
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
          <Field label="锁定" className="reference-field reference-lock">
            <Switch
              checked={reference.locked}
              disabled={disabled}
              onCheckedChange={(checked) => onChange({ locked: checked })}
            />
          </Field>
        </div>
        <Field label="备注" className="reference-note">
          <TextField
            value={reference.note}
            maxLength={1000}
            disabled={disabled}
            placeholder="可选"
            onValueChange={(note) => onChange({ note })}
          />
        </Field>
        <div className="reference-row-actions">
          {!reference.isPrimary ? (
            <Button type="button" variant="quiet" size="sm" disabled={disabled} onClick={onSetPrimary}>
              设为主参考
            </Button>
          ) : null}
          {!reference.isPrimary ? (
            <>
              <IconButton
                type="button"
                variant="quiet"
                label="上移参考"
                disabled={disabled || auxiliaryIndex === 0}
                onClick={() => onMove(-1)}
              >
                ↑
              </IconButton>
              <IconButton
                type="button"
                variant="quiet"
                label="下移参考"
                disabled={disabled || auxiliaryIndex === null || auxiliaryIndex === auxiliaryCount - 1}
                onClick={() => onMove(1)}
              >
                ↓
              </IconButton>
            </>
          ) : null}
          <IconButton
            type="button"
            variant="quiet"
            label="移除参考"
            disabled={disabled || !canRemove}
            onClick={onRemove}
          >
            ×
          </IconButton>
        </div>
      </div>
    </div>
  )
}

export interface ReferenceSetEditorProps {
  project: ArtProjectDto
  version: ArtVersionDto
  disabled?: boolean
  onMutated: (mutation: ArtVersionMutationDto) => void
}

export const ReferenceSetEditor: React.FC<ReferenceSetEditorProps> = ({
  project,
  version,
  disabled = false,
  onMutated
}) => {
  const [references, setReferences] = useState<ReferenceDraft[]>(() => version.references.map(toDraft))
  const [localError, setLocalError] = useState<string | null>(null)

  useEffect(() => {
    setReferences(version.references.map(toDraft))
    setLocalError(null)
  }, [version.id])

  const current = useMemo(() => normalize(references), [references])
  const original = useMemo(() => baseline(version), [version])
  const dirty = serialize(current) !== serialize(original)
  const reason = inferReason(original, current)

  const primary = references.find((reference) => reference.isPrimary) ?? references[0]
  const auxiliaries = references.filter((reference) => reference.key !== primary?.key)

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
      setReferences((currentReferences) => {
        const currentPrimary =
          currentReferences.find((reference) => reference.isPrimary) ?? currentReferences[0]
        const additions: ReferenceDraft[] = assets.map((asset) => ({
          key: makeKey(),
          assetId: asset.id,
          role: 'other',
          note: '',
          weight: 1,
          locked: false,
          isPrimary: false
        }))
        if (!currentPrimary) return additions
        if (currentPrimary.isPrimary) return [...currentReferences, ...additions]
        return [{ ...currentPrimary, isPrimary: true }, ...currentReferences.slice(1), ...additions]
      })
    }
  })

  const saveMutation = useMutation({
    mutationFn: () => {
      if (current.length === 0) throw new Error('至少需要一张参考图。')
      if (
        current.some(
          (reference) => !Number.isFinite(reference.weight) || reference.weight < 0.1 || reference.weight > 2
        )
      ) {
        throw new Error('权重必须在 0.1 到 2 之间。')
      }
      return reviseArtVersionReferences(version.id, current, reason, project.rowVersion)
    },
    onSuccess: (mutation) => {
      setReferences(mutation.artVersion.references.map(toDraft))
      onMutated(mutation)
    }
  })

  const update = (key: string, patch: Partial<ReferenceDraft>): void => {
    setReferences((currentReferences) =>
      currentReferences.map((reference) => (reference.key === key ? { ...reference, ...patch } : reference))
    )
  }

  const remove = (key: string): void => {
    setReferences((currentReferences) => {
      if (currentReferences.length <= 1) return currentReferences
      const target = currentReferences.find((reference) => reference.key === key)
      const remaining = currentReferences.filter((reference) => reference.key !== key)
      if (!target?.isPrimary || remaining.length === 0) return remaining
      return remaining.map((reference, index) =>
        index === 0 ? { ...reference, isPrimary: true } : reference
      )
    })
  }

  const setPrimary = (key: string): void => {
    setReferences((currentReferences) =>
      currentReferences.map((reference) => ({
        ...reference,
        isPrimary: reference.key === key
      }))
    )
  }

  const move = (key: string, delta: -1 | 1): void => {
    setReferences((currentReferences) => {
      const currentPrimary =
        currentReferences.find((reference) => reference.isPrimary) ?? currentReferences[0]
      if (!currentPrimary) return currentReferences
      const others = currentReferences.filter((reference) => reference.key !== currentPrimary.key)
      const index = others.findIndex((reference) => reference.key === key)
      const target = index + delta
      if (index < 0 || target < 0 || target >= others.length) return currentReferences
      const next = [...others]
      ;[next[index], next[target]] = [next[target]!, next[index]!]
      return [currentPrimary, ...next]
    })
  }

  const error =
    localError ??
    (addMutation.error instanceof ApiError
      ? addMutation.error.message
      : (addMutation.error?.message ?? null)) ??
    (saveMutation.error instanceof ApiError
      ? saveMutation.error.message
      : (saveMutation.error?.message ?? null))

  return (
    <section className="reference-set-editor" data-testid="reference-set-editor">
      <SectionHeader
        title="参考集合"
        description="主参考固定为第 1 张；辅助参考按顺序参与生成。"
        actions={<StatusPill label={`${references.length}/${MAX_REFERENCES}`} />}
      />
      <div className="reference-list">
        {primary ? (
          <ReferenceRow
            reference={primary}
            index={0}
            auxiliaryIndex={null}
            auxiliaryCount={auxiliaries.length}
            disabled={disabled || saveMutation.isPending}
            canRemove={references.length > 1}
            onChange={(patch) => update(primary.key, patch)}
            onRemove={() => remove(primary.key)}
            onSetPrimary={() => setPrimary(primary.key)}
            onMove={() => undefined}
          />
        ) : null}
        {auxiliaries.map((reference, index) => (
          <ReferenceRow
            key={reference.key}
            reference={reference}
            index={index + 1}
            auxiliaryIndex={index}
            auxiliaryCount={auxiliaries.length}
            disabled={disabled || saveMutation.isPending}
            canRemove={references.length > 1}
            onChange={(patch) => update(reference.key, patch)}
            onRemove={() => remove(reference.key)}
            onSetPrimary={() => setPrimary(reference.key)}
            onMove={(delta) => move(reference.key, delta)}
          />
        ))}
      </div>

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
        <span>新图先上传为资产，再作为辅助参考加入；保存后生成新的不可变版本。</span>
      </FileDropZone>

      {error ? (
        <div role="alert">
          <InlineNotice tone="danger">{error}</InlineNotice>
        </div>
      ) : null}
      {dirty ? (
        <InlineNotice tone="info">
          保存会创建一个新的美术版本快照；源版本是当前参考时，新快照会成为当前参考。
        </InlineNotice>
      ) : null}

      <div className="form-actions">
        <Button
          type="button"
          variant="secondary"
          disabled={!dirty || saveMutation.isPending}
          onClick={() => {
            setReferences(version.references.map(toDraft))
            setLocalError(null)
          }}
        >
          重置
        </Button>
        <AsyncButton
          type="button"
          busy={saveMutation.isPending}
          busyLabel="保存中…"
          disabled={disabled || !dirty || addMutation.isPending || references.length === 0}
          onClick={() => {
            setLocalError(null)
            saveMutation.mutate()
          }}
        >
          保存为新版本
        </AsyncButton>
      </div>
    </section>
  )
}
