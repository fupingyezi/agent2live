import React, { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  AsyncButton,
  Button,
  Dialog,
  Field,
  FileDropZone,
  IconButton,
  InlineNotice,
  SurfaceCard,
  Textarea,
  TextField,
  type EmptyProps
} from '@agent2live/design-system'
import {
  characterBriefContentSchema,
  type CharacterBriefContent
} from '@agent2live/contracts/character-brief'
import { ApiError, createArtProject, createCharacter, submitPromptInput } from '@studio/api'
import { queryKeys } from '@studio/api'
import type { ArtProjectDto, CharacterDto, CreateCharacterInput, MaterialRole } from '@studio/api'
import deleteIcon from '@studio/assets/reference-actions/delete.png'
import editIcon from '@studio/assets/reference-actions/edit.png'
import previewIcon from '@studio/assets/reference-actions/preview.png'
import { CharacterReferenceEditor } from './new-character/CharacterReferenceEditor'
import {
  normalizeCharacterReferences,
  setPrimaryReference,
  strengthToWeight,
  type CharacterReferenceDraft
} from './new-character/reference-draft'

const DRAFT_KEY = 'agent2live:new-character-draft'

const MAX_REFERENCES = 6

const MAX_FILE_BYTES = 20 * 1024 * 1024

const ACCEPTED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])

interface CharacterDraft {
  title: string
  summary: string
  supplement: string
}

interface CharacterBootstrapResult {
  character: CharacterDto
  project: ArtProjectDto
  inputSubmissionId: string
  draftId: string
}

const EMPTY_DRAFT: CharacterDraft = { title: '', summary: '', supplement: '' }

const REFERENCE_ROLE_LABELS: Record<MaterialRole, string> = {
  identity_reference: '身份',
  style_reference: '画风',
  outfit_reference: '服装',
  color_reference: '配色',
  background_reference: '背景',
  pose_reference: '姿势',
  sketch: '草图',
  texture: '质感',
  other: '其他'
}

export class CharacterProvisioningError extends Error {
  readonly characterId: string
  readonly projectId: string | null
  readonly originalError: unknown

  constructor(message: string, characterId: string, projectId: string | null, originalError: unknown) {
    super(message)
    this.name = 'CharacterProvisioningError'
    this.characterId = characterId
    this.projectId = projectId
    this.originalError = originalError
  }
}

export function buildCharacterBrief(draft: CharacterDraft): CharacterBriefContent {
  return characterBriefContentSchema.parse({
    schemaVersion: 'character-brief/1',
    identity: { fullName: draft.title.trim() },
    background: { summary: draft.summary.trim() },
    notes: draft.supplement.trim()
  })
}

function readDraft(): CharacterDraft {
  try {
    const stored = window.localStorage.getItem(DRAFT_KEY)
    if (!stored) return EMPTY_DRAFT
    const parsed = JSON.parse(stored) as Partial<CharacterDraft>
    return {
      title: typeof parsed.title === 'string' ? parsed.title : '',
      summary: typeof parsed.summary === 'string' ? parsed.summary : '',
      supplement: typeof parsed.supplement === 'string' ? parsed.supplement : ''
    }
  } catch {
    return EMPTY_DRAFT
  }
}

function storeDraft(draft: CharacterDraft): void {
  try {
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft))
  } catch {
    // Local draft recovery is optional; the active form remains usable without storage.
  }
}

function clearDraft(): void {
  try {
    window.localStorage.removeItem(DRAFT_KEY)
  } catch {
    // Ignore storage failures after a successful character creation.
  }
}

interface ReferencePreviewProps {
  reference: CharacterReferenceDraft
  index: number
  onEdit: (reference: CharacterReferenceDraft) => void
  onPreview: (reference: CharacterReferenceDraft) => void
  onRemove: (reference: CharacterReferenceDraft) => void
}

const ReferencePreview: React.FC<ReferencePreviewProps> = ({
  reference,
  index,
  onEdit,
  onPreview,
  onRemove
}) => {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    const objectUrl = URL.createObjectURL(reference.file)
    setUrl(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [reference.file])

  return (
    <figure
      className="new-character-reference"
      data-testid="character-reference-card"
      data-file-name={reference.file.name}
      data-role={reference.role}
      data-strength={reference.strength}
      data-primary={reference.isPrimary}
    >
      <div className="new-character-reference-image">
        {url ? <img src={url} alt={reference.file.name} /> : <span>…</span>}
        <span className="new-character-reference-role">{REFERENCE_ROLE_LABELS[reference.role]}</span>
        {reference.isPrimary ? <span className="new-character-reference-primary">主图</span> : null}
        <div className="new-character-reference-hover" data-testid="reference-hover-actions">
          <button type="button" onClick={() => onPreview(reference)}>
            <img src={previewIcon} alt="" aria-hidden="true" />
            <span>预览</span>
          </button>
          <button type="button" onClick={() => onEdit(reference)}>
            <img src={editIcon} alt="" aria-hidden="true" />
            <span>编辑</span>
          </button>
        </div>
        <IconButton
          type="button"
          className="new-character-reference-remove"
          label={`移除参考图 ${reference.file.name}`}
          onClick={() => onRemove(reference)}
        >
          <img src={deleteIcon} alt="" aria-hidden="true" />
        </IconButton>
      </div>
      <figcaption>
        <span title={reference.file.name}>{reference.file.name}</span>
        <small>
          参考图 {index + 1} · 权重 {strengthToWeight(reference.strength)}
        </small>
      </figcaption>
    </figure>
  )
}

interface ReferencePreviewDialogProps {
  reference: CharacterReferenceDraft | null
  onClose: () => void
}

const ReferencePreviewDialog: React.FC<ReferencePreviewDialogProps> = ({ reference, onClose }) => {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!reference) {
      setUrl(null)
      return
    }
    const objectUrl = URL.createObjectURL(reference.file)
    setUrl(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [reference])

  return (
    <Dialog
      open={reference !== null}
      title="预览参考图"
      description={reference?.file.name}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      className="reference-preview-dialog"
    >
      {url ? <img className="reference-preview-dialog-image" src={url} alt={reference?.file.name} /> : null}
    </Dialog>
  )
}

export const NewCharacterPage: React.FC<EmptyProps> = () => {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<CharacterDraft>(readDraft)
  const [references, setReferences] = useState<CharacterReferenceDraft[]>([])
  const [editingReferenceId, setEditingReferenceId] = useState<string | null>(null)
  const [previewReferenceId, setPreviewReferenceId] = useState<string | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)

  const updateDraft = (patch: Partial<CharacterDraft>): void => {
    setDraft((current) => {
      const next = { ...current, ...patch }
      storeDraft(next)
      return next
    })
    setLocalError(null)
    if (mutation.isError) mutation.reset()
  }

  const addReferences = (files: File[]): void => {
    const available = MAX_REFERENCES - references.length
    if (available <= 0) {
      setLocalError(`最多 ${MAX_REFERENCES} 张参考图。`)
      return
    }
    const accepted: File[] = []
    for (const file of files.slice(0, available)) {
      if (!ACCEPTED_TYPES.has(file.type)) {
        setLocalError(`“${file.name}”不是 PNG、JPEG 或 WEBP。`)
        continue
      }
      if (file.size > MAX_FILE_BYTES) {
        setLocalError(`“${file.name}”超过 20MB。`)
        continue
      }
      accepted.push(file)
    }
    if (files.length > available) {
      setLocalError(`最多 ${MAX_REFERENCES} 张参考图，已忽略超出部分。`)
    }
    if (accepted.length > 0) {
      setReferences((current) =>
        normalizeCharacterReferences([
          ...current,
          ...accepted.map(
            (file, index): CharacterReferenceDraft => ({
              id:
                typeof crypto.randomUUID === 'function'
                  ? crypto.randomUUID()
                  : `${Date.now()}-${index}-${file.lastModified}`,
              file,
              role: current.length === 0 && index === 0 ? 'identity_reference' : 'other',
              strength: 'balanced',
              note: '',
              isPrimary: current.length === 0 && index === 0
            })
          )
        ]).slice(0, MAX_REFERENCES)
      )
    }
  }

  const submitCharacterInput = async (projectId: string) => {
    const brief = buildCharacterBrief(draft)
    const files = new Map<string, File>()
    const materials = references.map((reference, index) => {
      const fileField = `file_reference_${index}`
      files.set(fileField, reference.file)
      return {
        partName: reference.file.name.replace(/\.[^.]+$/, '').slice(0, 80) || `参考图 ${index + 1}`,
        fileField,
        role: reference.role,
        note: reference.note.trim(),
        weight: strengthToWeight(reference.strength),
        locked: false,
        sortOrder: index
      }
    })
    return submitPromptInput(
      projectId,
      {
        characterBrief: brief,
        globalNotes: [brief.background.summary, brief.notes].filter(Boolean).join('\n\n'),
        requirements: [],
        materials
      },
      files,
      null
    )
  }

  const mutation = useMutation({
    mutationFn: async (input: CreateCharacterInput): Promise<CharacterBootstrapResult> => {
      const character = await createCharacter(input)
      let project: ArtProjectDto | null = null
      try {
        project = await createArtProject(character.id, {
          title: '默认造型',
          ...(draft.supplement.trim() ? { description: draft.supplement.trim() } : {})
        })
        const submitted = await submitCharacterInput(project.id)
        return {
          character,
          project,
          inputSubmissionId: submitted.submission.id,
          draftId: submitted.draft.id
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        throw new CharacterProvisioningError(message, character.id, project?.id ?? null, error)
      }
    },
    onSuccess: ({ character, project }) => {
      clearDraft()
      void queryClient.invalidateQueries({ queryKey: queryKeys.characters })
      void queryClient.invalidateQueries({ queryKey: queryKeys.lineage(character.id) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.project(project.id) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.workspace(project.id) })
      navigate(
        `/characters/${encodeURIComponent(character.id)}/created?project=${encodeURIComponent(project.id)}`
      )
    }
  })

  const retryMutation = useMutation({
    mutationFn: async (provisioning: CharacterProvisioningError) => {
      if (!provisioning.projectId) throw new Error('默认造型尚未创建。')
      await submitCharacterInput(provisioning.projectId)
      return provisioning
    },
    onSuccess: (provisioning) => {
      clearDraft()
      void queryClient.invalidateQueries({ queryKey: queryKeys.characters })
      void queryClient.invalidateQueries({ queryKey: queryKeys.lineage(provisioning.characterId) })
      if (!provisioning.projectId) return
      void queryClient.invalidateQueries({ queryKey: queryKeys.project(provisioning.projectId) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.workspace(provisioning.projectId) })
      navigate(
        `/characters/${encodeURIComponent(provisioning.characterId)}/created?project=${encodeURIComponent(provisioning.projectId)}`
      )
    }
  })

  const onSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const cleanTitle = draft.title.trim()
    if (!cleanTitle) {
      setLocalError('请输入角色名称。')
      return
    }
    if (cleanTitle.length > 100) {
      setLocalError('角色名称不能超过 100 个字符。')
      return
    }
    if (draft.summary.trim().length > 2000) {
      setLocalError('角色设定不能超过 2000 个字符。')
      return
    }
    if (draft.supplement.trim().length > 4000) {
      setLocalError('补充说明不能超过 4000 个字符。')
      return
    }
    setLocalError(null)
    const summary = draft.summary.trim()
    mutation.mutate(summary ? { title: cleanTitle, summary } : { title: cleanTitle })
  }

  const provisioningError = mutation.error instanceof CharacterProvisioningError ? mutation.error : null
  const serverError =
    mutation.error instanceof ApiError || mutation.error instanceof CharacterProvisioningError
      ? mutation.error.message
      : null
  const errorCode = mutation.error instanceof ApiError ? mutation.error.code : null
  const editingReference = references.find((reference) => reference.id === editingReferenceId) ?? null
  const previewReference = references.find((reference) => reference.id === previewReferenceId) ?? null

  const removeReference = (reference: CharacterReferenceDraft): void => {
    setReferences((current) =>
      normalizeCharacterReferences(current.filter((item) => item.id !== reference.id))
    )
    if (editingReferenceId === reference.id) setEditingReferenceId(null)
    if (previewReferenceId === reference.id) setPreviewReferenceId(null)
  }

  const completeReferenceEdit = (reference: CharacterReferenceDraft): void => {
    setReferences((current) => {
      const updated = current.map((item) => (item.id === reference.id ? reference : item))
      return reference.isPrimary
        ? setPrimaryReference(updated, reference.id)
        : normalizeCharacterReferences(updated)
    })
    setEditingReferenceId(null)
  }

  return (
    <div className="studio-page new-character-page">
      <header className="new-character-header">
        <div>
          <span>角色</span>
          <h1>新建角色</h1>
        </div>
        <div className="new-character-steps" aria-label="创建步骤">
          <span data-state="active">写设定</span>
          <span data-state="upcoming">出立绘</span>
        </div>
      </header>

      <form className="new-character-form" onSubmit={onSubmit} noValidate>
        <div className="new-character-shell">
          <SurfaceCard className="new-character-copy-card">
            <div className="new-character-field-stack">
              <Field id="character-title" label="角色名称" required>
                <TextField
                  id="character-title"
                  value={draft.title}
                  maxLength={100}
                  autoFocus
                  placeholder="给角色起个名字"
                  onValueChange={(title) => updateDraft({ title })}
                />
              </Field>
              <Field id="character-summary" label="角色简介">
                <Textarea
                  id="character-summary"
                  value={draft.summary}
                  maxLength={2000}
                  rows={8}
                  placeholder="例如：住在屋檐上的白发仙人，替人挡雨为生。"
                  onValueChange={(summary) => updateDraft({ summary })}
                />
              </Field>
              <Field id="character-supplement" label="补充说明">
                <Textarea
                  id="character-supplement"
                  value={draft.supplement}
                  maxLength={4000}
                  rows={4}
                  placeholder="例如：伞要始终可见，不要发光特效。"
                  onValueChange={(supplement) => updateDraft({ supplement })}
                />
              </Field>
            </div>
          </SurfaceCard>

          <SurfaceCard
            className="new-character-reference-card"
            title="参考图"
            actions={
              <span className="studio-meta">
                {references.length} / {MAX_REFERENCES}
              </span>
            }
          >
            <div className="new-character-reference-grid">
              {references.map((reference, index) => (
                <ReferencePreview
                  key={reference.id}
                  reference={reference}
                  index={index}
                  onEdit={(selected) => setEditingReferenceId(selected.id)}
                  onPreview={(selected) => setPreviewReferenceId(selected.id)}
                  onRemove={removeReference}
                />
              ))}
              {references.length < MAX_REFERENCES ? (
                <FileDropZone
                  label="上传参考图"
                  accept="image/png,image/jpeg,image/webp"
                  multiple
                  onFiles={addReferences}
                  className="new-character-drop-zone"
                >
                  <span className="new-character-add-icon" aria-hidden="true">
                    +
                  </span>
                  <strong>拖入图片，或点选上传</strong>
                  <span>身份、画风、服装、配色、姿态和草图</span>
                  <small>最多 6 张，单张不超过 20MB</small>
                </FileDropZone>
              ) : (
                <p className="new-character-reference-full" role="status">
                  6 张已满，删除一张后继续上传
                </p>
              )}
            </div>
          </SurfaceCard>
        </div>

        {localError ? (
          <InlineNotice tone="danger">
            <span role="alert">{localError}</span>
          </InlineNotice>
        ) : null}
        {serverError ? (
          <InlineNotice tone="danger">
            <p role="alert">{serverError}</p>
            {provisioningError ? (
              <div className="new-character-recovery-actions">
                <Button asChild variant="secondary">
                  <Link to={`/characters/${encodeURIComponent(provisioningError.characterId)}`}>
                    进入角色卡片
                  </Link>
                </Button>
                {provisioningError.projectId ? (
                  <>
                    <Button asChild variant="secondary">
                      <Link
                        to={`/characters/${encodeURIComponent(provisioningError.characterId)}/art?project=${encodeURIComponent(provisioningError.projectId)}`}
                      >
                        打开默认造型
                      </Link>
                    </Button>
                    <AsyncButton
                      type="button"
                      variant="secondary"
                      busy={retryMutation.isPending}
                      busyLabel="重新提交中…"
                      onClick={() => retryMutation.mutate(provisioningError)}
                    >
                      重新提交输入
                    </AsyncButton>
                  </>
                ) : null}
              </div>
            ) : null}
            {errorCode ? (
              <p className="studio-meta">
                错误码：<code>{errorCode}</code>
              </p>
            ) : null}
          </InlineNotice>
        ) : null}

        <div className="new-character-footer">
          <span className="studio-meta">设定会保存在本机；图片不会进入浏览器草稿存储</span>
          <div className="studio-form-actions">
            <Button asChild variant="quiet">
              <Link to="/">取消</Link>
            </Button>
            <AsyncButton type="submit" busy={mutation.isPending} busyLabel="创建中…">
              创建并生成
            </AsyncButton>
          </div>
        </div>
      </form>
      {editingReference ? (
        <CharacterReferenceEditor
          reference={editingReference}
          onCancel={() => setEditingReferenceId(null)}
          onComplete={completeReferenceEdit}
        />
      ) : null}
      <ReferencePreviewDialog reference={previewReference} onClose={() => setPreviewReferenceId(null)} />
    </div>
  )
}
