import React, { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { MATERIAL_ROLES, type MaterialRole } from '@agent2live/contracts/prompt'
import type { PromptDraftDto, PromptRequirement, PromptInputSubmissionDto } from '@studio/api'
import { submitPromptInput } from '@studio/api'
import { queryKeys } from '@studio/api'
import { ApiError } from '@studio/api'
import { useAssetUrl } from '@studio/hooks'
import {
  AsyncButton,
  Button,
  CountBadge,
  Field,
  FileDropZone,
  IconButton,
  InlineNotice,
  SectionHeader,
  Select,
  Switch,
  TextField,
  Textarea
} from '@agent2live/design-system'
import styles from './PromptInputPanel.module.scss'

const ROLE_LABELS: Record<MaterialRole, string> = {
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

const STRENGTH_LABELS = { must: '必须', prefer: '偏好', avoid: '避免' } as const

const MAX_FILES = 14

const MAX_FILE_BYTES = 20 * 1024 * 1024

const ACCEPTED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])

interface EditableMaterial {
  key: string
  assetId?: string
  file?: File
  fileField?: string
  role: MaterialRole
  note: string
  weight: number
  locked: boolean
  sortOrder: number
}

function makeKey(): string {
  return crypto.randomUUID()
}

function makeFileField(): string {
  return `file_${crypto.randomUUID().replaceAll('-', '').slice(0, 24)}`
}

function partNameFromFile(file: File): string {
  const base = file.name.replace(/\.[^.]+$/, '').trim()
  return (base || '素材').slice(0, 80)
}

function uniquePartName(value: string, used: Set<string>): string {
  if (!used.has(value)) return value
  for (let index = 2; index < 100; index += 1) {
    const candidate = `${value} ${index}`.slice(0, 80)
    if (!used.has(candidate)) return candidate
  }
  return `${value} ${makeKey().slice(0, 6)}`.slice(0, 80)
}

interface LocalFileThumbProps {
  file: File
}

const LocalFileThumb: React.FC<LocalFileThumbProps> = ({ file }) => {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    const objectUrl = URL.createObjectURL(file)
    setUrl(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [file])
  return url ? <img src={url} alt={file.name} /> : <span>…</span>
}

interface StoredAssetThumbProps {
  assetId: string
}

const StoredAssetThumb: React.FC<StoredAssetThumbProps> = ({ assetId }) => {
  const { url, isLoading } = useAssetUrl(assetId)
  return url ? <img src={url} alt="已上传素材" /> : <span>{isLoading ? '…' : '—'}</span>
}

function materialTitle(material: EditableMaterial): string {
  return material.file ? material.file.name : `${ROLE_LABELS[material.role]} ${material.sortOrder + 1}`
}

function fromSubmission(submission: PromptInputSubmissionDto | null): EditableMaterial[] {
  if (!submission) return []
  return submission.materials.map((material) => ({
    key: makeKey(),
    assetId: material.assetId,
    role: material.role,
    note: material.note,
    weight: material.weight,
    locked: material.locked,
    sortOrder: material.sortOrder
  }))
}

export interface PromptInputPanelProps {
  projectId: string
  draftRowVersion: number | null
  submission: PromptInputSubmissionDto | null
  disabled?: boolean
  onSubmitted: (result: { draft: PromptDraftDto; warnings: string[] }) => void
}

export const PromptInputPanel: React.FC<PromptInputPanelProps> = ({
  projectId,
  draftRowVersion,
  submission,
  disabled = false,
  onSubmitted
}) => {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(!submission)
  const [globalNotes, setGlobalNotes] = useState(submission?.globalNotes ?? '')
  const [requirements, setRequirements] = useState<PromptRequirement[]>(() =>
    structuredClone(submission?.requirements ?? [])
  )
  const [materials, setMaterials] = useState<EditableMaterial[]>(() => fromSubmission(submission))
  const [localError, setLocalError] = useState<string | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])

  useEffect(() => {
    setGlobalNotes(submission?.globalNotes ?? '')
    setRequirements(structuredClone(submission?.requirements ?? []))
    setMaterials(fromSubmission(submission))
    setLocalError(null)
  }, [submission?.id])

  const mutation = useMutation({
    mutationFn: async () => {
      const files = new Map<string, File>()
      const usedNames = new Set<string>()
      const cleaned = materials.map((material, index) => {
        if (!material.assetId && !material.file) throw new Error(`第 ${index + 1} 个素材还没有选择文件。`)
        if (!Number.isFinite(material.weight) || material.weight < 0.1 || material.weight > 2) {
          throw new Error(`第 ${index + 1} 个素材的权重必须在 0.1 到 2 之间。`)
        }
        if (material.file) {
          if (!ACCEPTED_TYPES.has(material.file.type))
            throw new Error(`“${material.file.name}”不是 PNG/JPEG/WEBP。`)
          if (material.file.size > MAX_FILE_BYTES) throw new Error(`“${material.file.name}”超过 20MB。`)
          if (!material.fileField) throw new Error('文件字段缺失。')
          files.set(material.fileField, material.file)
        }
        const baseName = material.file ? partNameFromFile(material.file) : `${material.role}_${index + 1}`
        const partName = uniquePartName(baseName, usedNames)
        usedNames.add(partName)
        return {
          partName,
          ...(material.assetId ? { assetId: material.assetId } : { fileField: material.fileField! }),
          role: material.role,
          note: material.note,
          weight: material.weight,
          locked: material.locked,
          sortOrder: index
        }
      })
      const cleanRequirements = requirements.map((requirement) => ({
        ...requirement,
        text: requirement.text.trim()
      }))
      if (cleanRequirements.some((requirement) => requirement.text.length === 0)) {
        throw new Error('每条要求都需要文字。')
      }
      return submitPromptInput(
        projectId,
        { globalNotes: globalNotes.trim(), requirements: cleanRequirements, materials: cleaned },
        files,
        draftRowVersion
      )
    },
    onSuccess: (result) => {
      setWarnings(result.warnings)
      setOpen(false)
      setMaterials(fromSubmission(result.submission))
      setRequirements(structuredClone(result.submission.requirements))
      void queryClient.invalidateQueries({ queryKey: queryKeys.workspace(projectId) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.lineages })
      void queryClient.invalidateQueries({ queryKey: queryKeys.characters })
      onSubmitted({ draft: result.draft, warnings: result.warnings })
    }
  })

  const addFiles = (files: File[]): void => {
    if (files.length === 0) return
    setLocalError(null)
    setMaterials((current) => {
      const available = MAX_FILES - current.length
      if (files.length > available) {
        setLocalError(`最多 ${MAX_FILES} 个素材，已忽略超出部分。`)
      }
      const additions: EditableMaterial[] = files.slice(0, Math.max(0, available)).map((file, index) => ({
        key: makeKey(),
        file,
        fileField: makeFileField(),
        role: current.length === 0 && index === 0 ? 'identity_reference' : 'other',
        note: '',
        weight: 1,
        locked: false,
        sortOrder: current.length + index
      }))
      return [...current, ...additions]
    })
  }

  const updateMaterial = (key: string, patch: Partial<EditableMaterial>): void => {
    setMaterials((current) => current.map((item) => (item.key === key ? { ...item, ...patch } : item)))
  }

  const removeMaterial = (key: string): void => {
    setMaterials((current) => current.filter((item) => item.key !== key))
  }

  const errorMessage =
    localError ??
    (mutation.error instanceof ApiError ? mutation.error.message : (mutation.error?.message ?? null))

  return (
    <section
      className={`${styles['workbench-panel']!} prompt-input-panel`}
      data-testid="prompt-input-panel"
      aria-busy={mutation.isPending}
    >
      <SectionHeader
        title="素材与要求"
        description="输入"
        actions={
          <Button
            type="button"
            variant="quiet"
            size="sm"
            aria-expanded={open}
            aria-controls="prompt-input-body"
            onClick={() => setOpen((value) => !value)}
          >
            {open ? '收起' : '展开'}
          </Button>
        }
      />

      {open ? (
        <div className={styles['input-panel-body']!} id="prompt-input-body">
          <div className={styles['requirements-editor']!}>
            <SectionHeader
              title="要求"
              actions={
                <div className={styles['inline-actions']!}>
                  <Button
                    type="button"
                    variant="quiet"
                    size="sm"
                    disabled={disabled}
                    onClick={() =>
                      setRequirements((current) => [
                        ...current,
                        {
                          id: `req-${crypto.randomUUID()}`,
                          text: '',
                          strength: 'must'
                        }
                      ])
                    }
                  >
                    + 必须
                  </Button>
                  <Button
                    type="button"
                    variant="quiet"
                    size="sm"
                    disabled={disabled}
                    onClick={() =>
                      setRequirements((current) => [
                        ...current,
                        {
                          id: `req-${crypto.randomUUID()}`,
                          text: '',
                          strength: 'prefer'
                        }
                      ])
                    }
                  >
                    + 偏好
                  </Button>
                  <Button
                    type="button"
                    variant="quiet"
                    size="sm"
                    disabled={disabled}
                    onClick={() =>
                      setRequirements((current) => [
                        ...current,
                        {
                          id: `req-${crypto.randomUUID()}`,
                          text: '',
                          strength: 'avoid'
                        }
                      ])
                    }
                  >
                    + 避免
                  </Button>
                </div>
              }
            />
            {requirements.length === 0 ? (
              <p className="muted">可选：写下必须满足、偏好或必须避免的要求。</p>
            ) : null}
            <div className={styles['requirement-rows']!}>
              {requirements.map((requirement) => (
                <div className={styles['requirement-row']!} key={requirement.id}>
                  <Field label="强度" className={styles['requirement-strength']!}>
                    <Select
                      value={requirement.strength}
                      disabled={disabled}
                      onValueChange={(value) =>
                        setRequirements((current) =>
                          current.map((item) =>
                            item.id === requirement.id
                              ? { ...item, strength: value as PromptRequirement['strength'] }
                              : item
                          )
                        )
                      }
                    >
                      {Object.entries(STRENGTH_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="要求内容" className={styles['requirement-text']!}>
                    <TextField
                      value={requirement.text}
                      maxLength={500}
                      disabled={disabled}
                      placeholder={
                        requirement.strength === 'avoid' ? '例如：不要高饱和背景' : '例如：黑色长发，冷静表情'
                      }
                      onValueChange={(value) =>
                        setRequirements((current) =>
                          current.map((item) =>
                            item.id === requirement.id ? { ...item, text: value } : item
                          )
                        )
                      }
                    />
                  </Field>
                  <IconButton
                    type="button"
                    variant="quiet"
                    label="删除要求"
                    disabled={disabled}
                    onClick={() =>
                      setRequirements((current) => current.filter((item) => item.id !== requirement.id))
                    }
                  >
                    ×
                  </IconButton>
                </div>
              ))}
            </div>
          </div>

          <div className={styles['material-editor']!}>
            <SectionHeader title="素材" actions={<CountBadge value={materials.length} max={MAX_FILES} />} />
            {submission ? (
              <InlineNotice tone="info">
                参考图通过独立参考图编辑入口维护；这里仅调整已提交素材的用途、权重和备注。
              </InlineNotice>
            ) : (
              <FileDropZone
                label="上传素材图片"
                accept="image/png,image/jpeg,image/webp"
                multiple
                disabled={disabled}
                onFiles={addFiles}
              >
                <strong>上传参考图</strong>
                <span>拖放或点击选择 PNG/JPEG/WEBP，单张最大 20MB，最多 14 张。</span>
              </FileDropZone>
            )}
            <div className={styles['material-editor-list']!}>
              {materials.map((material) => (
                <div className={styles['material-editor-row']!} key={material.key}>
                  <div className={styles['material-thumb']!}>
                    {material.file ? (
                      <LocalFileThumb file={material.file} />
                    ) : material.assetId ? (
                      <StoredAssetThumb assetId={material.assetId} />
                    ) : (
                      <span>—</span>
                    )}
                  </div>
                  <div className={styles['material-fields']!}>
                    <p className={styles['material-name']!}>{materialTitle(material)}</p>
                    <div className={styles['material-inline']!}>
                      <Field label="角色" className={styles['material-field']!}>
                        <Select
                          value={material.role}
                          disabled={disabled}
                          onValueChange={(value) =>
                            updateMaterial(material.key, { role: value as MaterialRole })
                          }
                        >
                          {MATERIAL_ROLES.map((role) => (
                            <option key={role} value={role}>
                              {ROLE_LABELS[role]}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <Field label="权重" className={styles['material-field']!}>
                        <TextField
                          type="number"
                          min={0.1}
                          max={2}
                          step={0.1}
                          value={material.weight}
                          disabled={disabled}
                          onValueChange={(value) => updateMaterial(material.key, { weight: Number(value) })}
                        />
                      </Field>
                      <Field
                        label="锁定"
                        className={`${styles['material-field']!} ${styles['material-lock-field']!}`}
                      >
                        <Switch
                          checked={material.locked}
                          disabled={disabled}
                          onCheckedChange={(checked) => updateMaterial(material.key, { locked: checked })}
                        />
                      </Field>
                    </div>
                    <Field label="备注" className={styles['material-note']!}>
                      <TextField
                        value={material.note}
                        maxLength={1000}
                        disabled={disabled}
                        placeholder="备注（可选）"
                        onValueChange={(value) => updateMaterial(material.key, { note: value })}
                      />
                    </Field>
                  </div>
                  <IconButton
                    type="button"
                    variant="quiet"
                    label="移除素材"
                    disabled={disabled}
                    onClick={() => removeMaterial(material.key)}
                  >
                    ×
                  </IconButton>
                </div>
              ))}
            </div>
          </div>

          <Field
            label="整体说明"
            description="可选；世界观、用途、整体气质等。不要填写密钥或隐私。"
            className={styles['global-notes-field']!}
          >
            <Textarea
              rows={3}
              maxLength={8000}
              value={globalNotes}
              disabled={disabled}
              placeholder="例如：用于桌面宠物，气质冷静，整体低饱和。"
              onValueChange={setGlobalNotes}
            />
          </Field>

          {errorMessage ? (
            <div role="alert">
              <InlineNotice tone="danger">{errorMessage}</InlineNotice>
            </div>
          ) : null}
          {warnings.length > 0 ? (
            <InlineNotice tone="success">
              <strong>提交成功，但有提示</strong>
              <ul>
                {warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </InlineNotice>
          ) : null}

          <div className="form-actions">
            {submission ? (
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
                取消
              </Button>
            ) : null}
            <AsyncButton
              type="button"
              busy={mutation.isPending}
              busyLabel="提交中…"
              disabled={disabled}
              onClick={() => {
                setLocalError(null)
                setWarnings([])
                mutation.mutate()
              }}
            >
              {submission ? '更新素材与要求' : '提交素材与要求'}
            </AsyncButton>
          </div>
        </div>
      ) : null}
    </section>
  )
}
