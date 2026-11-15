import React, { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  AsyncButton,
  Button,
  Field,
  FileDropZone,
  IconButton,
  InlineNotice,
  PageHeader,
  SurfaceCard,
  Textarea,
  TextField,
  type EmptyProps
} from '@agent2live/design-system'
import { ApiError, createArtProject, createCharacter, submitPromptInput } from '@studio/api'
import { queryKeys } from '@studio/api'
import type { CreateCharacterInput, MaterialRole } from '@studio/api'

const DRAFT_KEY = 'agent2live:new-character-draft'

const MAX_REFERENCES = 6

const MAX_FILE_BYTES = 20 * 1024 * 1024

const ACCEPTED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])

interface CharacterDraft {
  title: string
  summary: string
  supplement: string
}

const EMPTY_DRAFT: CharacterDraft = { title: '', summary: '', supplement: '' }

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

function referenceRole(index: number): MaterialRole {
  if (index === 0) return 'identity_reference'
  if (index === 1) return 'style_reference'
  return 'other'
}

interface ReferencePreviewProps {
  file: File
  index: number
  onRemove: (index: number) => void
}

const ReferencePreview: React.FC<ReferencePreviewProps> = ({ file, index, onRemove }) => {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    const objectUrl = URL.createObjectURL(file)
    setUrl(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [file])

  return (
    <figure className="new-character-reference" data-testid="character-reference-card">
      <div className="new-character-reference-image">
        {url ? <img src={url} alt={file.name} /> : <span>…</span>}
        <span className="new-character-reference-role">
          {index === 0 ? '身份' : index === 1 ? '画风' : '参考'}
        </span>
      </div>
      <figcaption>
        <span title={file.name}>{file.name}</span>
        <IconButton type="button" label={`移除参考图 ${index + 1}`} onClick={() => onRemove(index)}>
          ×
        </IconButton>
      </figcaption>
    </figure>
  )
}

export const NewCharacterPage: React.FC<EmptyProps> = () => {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<CharacterDraft>(readDraft)
  const [references, setReferences] = useState<File[]>([])
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
      setReferences((current) => [...current, ...accepted].slice(0, MAX_REFERENCES))
    }
  }

  const mutation = useMutation({
    mutationFn: async (input: CreateCharacterInput) => {
      const character = await createCharacter(input)
      if (references.length === 0) {
        return { character, project: null, hasReferences: false }
      }
      const project = await createArtProject(character.id, {
        title: '默认造型',
        ...(draft.supplement.trim() ? { description: draft.supplement.trim() } : {})
      })
      const files = new Map<string, File>()
      const materials = references.map((file, index) => {
        const fileField = `file_reference_${index}`
        files.set(fileField, file)
        return {
          partName: file.name.replace(/\.[^.]+$/, '').slice(0, 80) || `参考图 ${index + 1}`,
          fileField,
          role: referenceRole(index),
          note: index === 0 ? '角色身份参考' : index === 1 ? '画风参考' : '补充参考',
          weight: 1,
          locked: false,
          sortOrder: index
        }
      })
      await submitPromptInput(
        project.id,
        {
          globalNotes: draft.summary.trim(),
          requirements: [],
          materials
        },
        files,
        null
      )
      return { character, project, hasReferences: true }
    },
    onSuccess: ({ character, project, hasReferences }) => {
      clearDraft()
      void queryClient.invalidateQueries({ queryKey: queryKeys.characters })
      void queryClient.invalidateQueries({ queryKey: queryKeys.lineage(character.id) })
      navigate(
        hasReferences && project
          ? `/characters/${encodeURIComponent(character.id)}/art?project=${encodeURIComponent(project.id)}`
          : `/characters/${encodeURIComponent(character.id)}`
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

  const serverError = mutation.error instanceof ApiError ? mutation.error.message : null
  const errorCode = mutation.error instanceof ApiError ? mutation.error.code : null

  return (
    <div className="studio-page new-character-page">
      <PageHeader
        back={
          <Link className="studio-back" to="/">
            ← 返回角色
          </Link>
        }
        eyebrow="角色"
        title="新建角色"
        description="写设定，或直接添加参考图；两种入口都会进入同一条提示词与立绘链路。"
        actions={
          <div className="new-character-steps" aria-label="创建步骤">
            <span data-state="active">写设定</span>
            <span data-state="upcoming">出立绘</span>
          </div>
        }
      />

      <form className="new-character-shell" onSubmit={onSubmit} noValidate>
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
            <Field
              id="character-summary"
              label="角色简介"
              description="写下身份、处境与说话气质；外观可在参考图中表达。"
            >
              <Textarea
                id="character-summary"
                value={draft.summary}
                maxLength={2000}
                rows={8}
                placeholder="例如：住在屋檐上的白发仙人，替人挡雨为生。"
                onValueChange={(summary) => updateDraft({ summary })}
              />
            </Field>
            <Field id="character-supplement" label="补充说明" description="必须出现或必须避免的元素。">
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
          description="身份、画风、服装、配色、姿态和草图都可用于生成。"
          actions={
            <span className="studio-meta">
              {references.length} / {MAX_REFERENCES}
            </span>
          }
        >
          <div className="new-character-reference-grid">
            {references.map((file, index) => (
              <ReferencePreview
                key={`${file.name}-${file.lastModified}-${index}`}
                file={file}
                index={index}
                onRemove={(removeIndex) =>
                  setReferences((current) => current.filter((_, item) => item !== removeIndex))
                }
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
            ) : null}
          </div>
        </SurfaceCard>

        {localError ? (
          <InlineNotice tone="danger">
            <span role="alert">{localError}</span>
          </InlineNotice>
        ) : null}
        {serverError ? (
          <InlineNotice tone="danger">
            <p role="alert">{serverError}</p>
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
              创建角色
            </AsyncButton>
          </div>
        </div>
      </form>
    </div>
  )
}
